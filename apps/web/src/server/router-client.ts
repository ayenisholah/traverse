import { z } from "zod";
import type { TypedOperation } from "../generated/operations.ts";

const DEFAULT_TIMEOUT_MS = 10_000;

const responseSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullish(),
  errors: z.array(z.unknown()).optional(),
});

/** `incomplete` means the router answered, but a subgraph behind it failed for some fields. */
export type RouterResult<Data> = { ok: true; data: Data; incomplete: boolean } | { ok: false };

export interface RouterClient {
  run: <Data, Variables>(
    operation: TypedOperation<Data, Variables>,
    variables: Variables,
  ) => Promise<RouterResult<Data>>;
}

interface Options {
  url: string;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}

const parseBody = (text: string): z.infer<typeof responseSchema> | undefined => {
  try {
    return responseSchema.parse(JSON.parse(text));
  } catch {
    return undefined;
  }
};

/**
 * Runs generated operations on the public router by hash, never by text, because that router runs
 * persisted operations only (GR-2). The router's error messages stay here: they can carry upstream
 * text, so callers learn only that the answer is missing or incomplete.
 */
export const createRouterClient = ({
  url,
  fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: Options): RouterClient => ({
  run: async <Data, Variables>(
    operation: TypedOperation<Data, Variables>,
    variables: Variables,
  ) => {
    const text = await fetch(`${url}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        variables,
        extensions: { persistedQuery: { version: 1, sha256Hash: operation.sha256 } },
      }),
      // The router never redirects, so a redirect means the address is wrong.
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    }).then(
      (response) => (response.ok ? response.text() : undefined),
      () => undefined,
    );
    const body = text === undefined ? undefined : parseBody(text);
    if (body?.data == null) return { ok: false };
    return { ok: true, data: body.data as Data, incomplete: (body.errors ?? []).length > 0 };
  },
});
