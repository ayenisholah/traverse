import { z } from "zod";
import type { TypedOperation } from "../generated/operations.ts";
import type { PostGraphql } from "./post-graphql.ts";

const responseSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullish(),
  errors: z.array(z.unknown()).optional(),
});

/**
 * `data` is whatever the router sent, so the caller must parse it before using it. `incomplete`
 * means the router answered, but a subgraph behind it failed for some fields.
 */
export type RouterResult = { ok: true; data: unknown; incomplete: boolean } | { ok: false };

export interface RouterClient {
  run: <Data, Variables>(
    operation: TypedOperation<Data, Variables>,
    variables: Variables,
  ) => Promise<RouterResult>;
}

/**
 * Runs generated operations on the public router by hash, never by text, because that router runs
 * persisted operations only (GR-2). The router's error messages stay here, because they can carry
 * upstream text, so callers learn only that the answer is missing or incomplete.
 */
export const createRouterClient = (post: PostGraphql): RouterClient => ({
  run: async (operation, variables) => {
    const body = responseSchema.safeParse(
      await post({
        variables,
        extensions: { persistedQuery: { version: 1, sha256Hash: operation.sha256 } },
      }),
    );
    if (!body.success || body.data.data == null) return { ok: false };
    return {
      ok: true,
      data: body.data.data,
      incomplete: (body.data.errors ?? []).length > 0,
    };
  },
});
