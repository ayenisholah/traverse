import { readFileSync } from "node:fs";
import {
  createSubgraph,
  requireUser,
  type Subgraph,
  type SubgraphContext,
  type SubgraphDependencies,
} from "@traverse/subgraph-kit";
import { GraphQLError } from "graphql";
import pg from "pg";
import { z } from "zod";
import { isWorkspaceId, MAX_WORKSPACES, parseSave } from "./limits.ts";
import { createPostgresStore } from "./postgres-store.ts";
import type { WorkspaceStore } from "./store.ts";

const typeDefs = readFileSync(new URL("../schema.graphqls", import.meta.url), "utf8");

// Plain connections are for this machine or a service on a private network. Anything else must
// verify the server's certificate (NFR-7, U-23).
const isTrustedDatabaseUrl = (url: string): boolean => {
  const parsed = new URL(url);
  const isLocal = parsed.hostname === "127.0.0.1" || !parsed.hostname.includes(".");
  const isPostgres = parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";
  return isPostgres && (isLocal || parsed.searchParams.get("sslmode") === "verify-full");
};

const environmentSchema = z.object({
  DATABASE_URL: z
    .url({ abort: true })
    .refine(
      isTrustedDatabaseUrl,
      "must be postgres:// to a local service, or use sslmode=verify-full",
    ),
});

const notFound = () =>
  new GraphQLError("No such workspace.", { extensions: { code: "NOT_FOUND" } });

const resolvers = (store: WorkspaceStore) => ({
  Query: {
    workspaces: (_: unknown, __: unknown, context: SubgraphContext) =>
      store.list(requireUser(context)),
    workspace: async (_: unknown, { id }: { id: string }, context: SubgraphContext) => {
      const userId = requireUser(context);
      return isWorkspaceId(id) ? ((await store.get(userId, id)) ?? null) : null;
    },
  },
  Mutation: {
    saveWorkspace: async (_: unknown, args: unknown, context: SubgraphContext) => {
      const userId = requireUser(context);
      const result = await store.save(userId, parseSave(args));
      if (result.kind === "saved") return result.workspace;
      if (result.kind === "not-found") throw notFound();
      throw new GraphQLError(
        `Keep at most ${String(MAX_WORKSPACES)} workspaces. Delete one first.`,
        {
          extensions: { code: "WORKSPACE_LIMIT" },
        },
      );
    },
    deleteWorkspace: (_: unknown, { id }: { id: string }, context: SubgraphContext) => {
      const userId = requireUser(context);
      return isWorkspaceId(id) ? store.delete(userId, id) : false;
    },
  },
});

export const createDatabasePool = (env: Record<string, string | undefined>): pg.Pool =>
  new pg.Pool({
    connectionString: environmentSchema.parse(env).DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5_000,
  });

/** Users' saved workspaces. It won't start without token settings (GR-3). */
export const createWorkspaceSubgraph = ({
  env = process.env,
  store,
  ...dependencies
}: SubgraphDependencies & { store?: WorkspaceStore } = {}): Subgraph => {
  const workspaces = store ?? createPostgresStore(createDatabasePool(env));
  return createSubgraph(
    {
      name: "workspace",
      typeDefs,
      resolvers: resolvers(workspaces),
      requiresUser: true,
      dispose: () => workspaces.close(),
    },
    { ...dependencies, env },
  );
};
