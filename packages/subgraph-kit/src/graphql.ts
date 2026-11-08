import type { GraphQLResolverMap } from "@apollo/subgraph/dist/resolvers.js";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse, type GraphQLSchema } from "graphql";
import { createYoga, type Plugin } from "graphql-yoga";
import type { VerifyUser } from "./auth.ts";
import { createErrorMask } from "./errors.ts";
import { MAX_REPRESENTATIONS } from "./limits.ts";
import type { Logger, RequestScope } from "./logging.ts";
import { invalidInput, type Upstream } from "./upstream.ts";

export interface SubgraphContext {
  userId: string | undefined;
  traceId: string;
  logger: Logger;
}

type Resolvers = GraphQLResolverMap<SubgraphContext>;

export interface SubgraphTools {
  /** One per source, each with its own cache keys and concurrency limit. */
  upstream: (source: string) => Upstream;
}

export interface SubgraphDefinition {
  name: string;
  typeDefs: string;
  resolvers: Resolvers | ((tools: SubgraphTools) => Resolvers);
}

export interface RequestContext {
  traceId: string;
  logger: Logger;
}

// Only the router calls a subgraph, and its fetches are small. Far larger bodies exhaust the heap.
const MAX_BODY_BYTES = 1_000_000;
const MAX_TOKENS = 20_000;

// The count covers the whole operation, because aliases can ask for `_entities` many times.
const limitEntities = (schema: GraphQLSchema): GraphQLSchema => {
  const field = schema.getQueryType()?.getFields()._entities;
  const resolve = field?.resolve;
  if (field && resolve) {
    const counts = new WeakMap<object, number>();
    field.resolve = (source, args: { representations: unknown[] }, context: object, info) => {
      const count = (counts.get(context) ?? 0) + args.representations.length;
      counts.set(context, count);
      if (count > MAX_REPRESENTATIONS) throw invalidInput("Too many entities in one request.");
      return resolve(source, args, context, info);
    };
  }
  return schema;
};

const limitTokens: Plugin = {
  onParse: ({ setParseFn }) => {
    setParseFn((source: string) => parse(source, { maxTokens: MAX_TOKENS }));
  },
};

export const createGraphql = (
  { typeDefs, resolvers }: SubgraphDefinition,
  tools: SubgraphTools,
  verifyUser: VerifyUser,
  scope: RequestScope,
) =>
  createYoga<RequestContext, SubgraphContext>({
    schema: limitEntities(
      buildSubgraphSchema([
        {
          typeDefs: parse(typeDefs),
          resolvers: typeof resolvers === "function" ? resolvers(tools) : resolvers,
        },
      ]),
    ),
    graphiql: false,
    landingPage: false,
    logging: false,
    cors: false,
    maxRequestBodySize: MAX_BODY_BYTES,
    plugins: [limitTokens],
    maskedErrors: { maskError: createErrorMask(scope.current) },
    context: async ({ request, traceId, logger }) => ({
      userId: await verifyUser(request.headers.get("authorization"), logger),
      traceId,
      logger,
    }),
  });
