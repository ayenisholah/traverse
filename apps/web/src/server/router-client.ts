import { z } from "zod";
import type { TypedOperation } from "../generated/operations.ts";

const DEFAULT_TIMEOUT_MS = 10_000;
// Far above any answer the public router's limits allow, and far below what could exhaust memory.
const MAX_BYTES = 1_000_000;

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

interface Options {
  url: string;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}

const readCapped = async (response: Response): Promise<string | undefined> => {
  if (!response.ok || response.body === null) return undefined;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
};

/**
 * Runs generated operations on the public router by hash, never by text, because that router runs
 * persisted operations only (GR-2). Nothing from the browser's request is passed on: no header, no
 * cookie and no address. The router's error messages stay here, because they can carry upstream
 * text, so callers learn only that the answer is missing or incomplete.
 */
export const createRouterClient = ({
  url,
  fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: Options): RouterClient => ({
  run: async (operation, variables) => {
    try {
      const response = await fetch(`${url}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          variables,
          extensions: { persistedQuery: { version: 1, sha256Hash: operation.sha256 } },
        }),
        // The router never redirects, so a redirect means the address is wrong.
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await readCapped(response);
      const body = text === undefined ? undefined : responseSchema.parse(JSON.parse(text));
      if (body?.data == null) return { ok: false };
      return { ok: true, data: body.data, incomplete: (body.errors ?? []).length > 0 };
    } catch {
      // No connection, no answer in time, a body that stops part way, or one that isn't JSON.
      return { ok: false };
    }
  },
});
