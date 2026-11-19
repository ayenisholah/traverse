import { z } from "zod";
import type { TypedOperation } from "../generated/operations.ts";
import type { PostGraphql } from "./post-graphql.ts";

const CODE = /^[A-Z_]{1,40}$/;
const codeOf = (error: unknown): unknown =>
  (error as { extensions?: { code?: unknown } } | null)?.extensions?.code;

// The router wraps a subgraph's errors in its own (C-57), and only their codes are read: fixed
// strings, never a message, which could carry upstream text.
const codesIn = (errors: unknown[]): string[] =>
  errors
    .flatMap((error) => [
      codeOf(error),
      ...((error as { extensions?: { errors?: unknown } } | null)?.extensions?.errors instanceof
      Array
        ? (error as { extensions: { errors: unknown[] } }).extensions.errors.map(codeOf)
        : []),
    ])
    .filter((code): code is string => typeof code === "string" && CODE.test(code));

const responseSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullish(),
  errors: z.array(z.unknown()).optional(),
});

/**
 * `data` is whatever the router sent, so the caller must parse it before using it. `incomplete`
 * means the router answered, but a subgraph behind it failed for some fields.
 */
export type RouterResult =
  { ok: true; data: unknown; incomplete: boolean } | { ok: false; codes?: string[] };

export interface RouterClient {
  /** `accessToken` is the signed-in user's, for operations on their own data. */
  run: <Data, Variables>(
    operation: TypedOperation<Data, Variables>,
    variables: Variables,
    accessToken?: string,
  ) => Promise<RouterResult>;
}

/**
 * Runs generated operations on the public router by hash, never by text, because that router runs
 * persisted operations only (GR-2). The router's error messages stay here, because they can carry
 * upstream text, so callers learn only that the answer is missing or incomplete.
 */
export const createRouterClient = (post: PostGraphql): RouterClient => ({
  run: async (operation, variables, accessToken) => {
    const request = {
      variables,
      extensions: { persistedQuery: { version: 1, sha256Hash: operation.sha256 } },
    };
    const answer = await (accessToken === undefined
      ? post(request)
      : post(request, { authorization: `Bearer ${accessToken}` }));
    const body = responseSchema.safeParse(answer);
    if (!body.success) return { ok: false };
    if (body.data.data == null) {
      const codes = codesIn(body.data.errors ?? []);
      return codes.length > 0 ? { ok: false, codes } : { ok: false };
    }
    return {
      ok: true,
      data: body.data.data,
      incomplete: (body.data.errors ?? []).length > 0,
    };
  },
});
