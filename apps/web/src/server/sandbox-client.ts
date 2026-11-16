import { Kind, OperationTypeNode, parse } from "graphql";
import { z } from "zod";
import type { RouteAnswer } from "../route/types.ts";
import type { PostGraphql } from "./post-graphql.ts";
import { toRoute } from "./route-model.ts";

const MAX_MESSAGES = 5;
const MAX_MESSAGE_LENGTH = 300;

const responseSchema = z.object({
  errors: z.array(z.object({ message: z.string() })).optional(),
  extensions: z.object({ queryPlan: z.unknown() }).optional(),
});

export interface SandboxClient {
  route: (operation: string, variables: Record<string, unknown>) => Promise<RouteAnswer>;
}

// Only queries run here. The sandbox router refuses the rest itself (C-52); this stops them before
// they leave the server, so that refusal never has to hold alone.
const writesIn = (operation: string): boolean => {
  try {
    return parse(operation).definitions.some(
      (definition) =>
        definition.kind === Kind.OPERATION_DEFINITION &&
        definition.operation !== OperationTypeNode.QUERY,
    );
  } catch {
    // The router explains a syntax error better than this can, and runs nothing.
    return false;
  }
};

const ONLY_QUERIES: RouteAnswer = {
  kind: "refused",
  messages: ["Only queries can run here: mutations and subscriptions can't."],
};

const hasData = (answer: unknown): boolean =>
  typeof answer === "object" && answer !== null && "data" in answer;

/**
 * Asks the sandbox router to run a free-form operation, and keeps only its route. The data the
 * operation returns is dropped here: nothing checks a free-form answer's shape, so none of it goes
 * to the browser (GR-16).
 *
 * A router that ran an operation answers with a `data` key, even when a subgraph failed, and a
 * subgraph's message can then be in `errors` (C-57). One that refused it before running, for a
 * syntax error, a field the schema doesn't have, a write or a limit, answers with `errors` alone,
 * and those describe the caller's own operation. Only those are passed on, cut short (GR-13).
 */
export const createSandboxClient = (post: PostGraphql): SandboxClient => ({
  route: async (operation, variables) => {
    if (writesIn(operation)) return ONLY_QUERIES;
    const answer = await post({ query: operation, variables });
    const body = responseSchema.safeParse(answer);
    if (!body.success) return { kind: "unavailable" };
    const plan = body.data.extensions?.queryPlan;
    if (plan !== undefined) {
      const route = toRoute(plan);
      return route === undefined ? { kind: "unavailable" } : { kind: "route", route };
    }
    const messages = (body.data.errors ?? [])
      .slice(0, MAX_MESSAGES)
      .map(({ message }) => message.slice(0, MAX_MESSAGE_LENGTH));
    if (hasData(answer) || messages.length === 0) return { kind: "unavailable" };
    return { kind: "refused", messages };
  },
});
