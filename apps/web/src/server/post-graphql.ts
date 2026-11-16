import { readCapped } from "./read-capped.ts";

const DEFAULT_TIMEOUT_MS = 10_000;
// Far above any answer the routers' limits allow, and far below what could exhaust memory.
const MAX_BYTES = 1_000_000;

interface Options {
  url: string;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}

export type PostGraphql = (body: unknown) => Promise<unknown>;

/**
 * Posts one GraphQL request to a router and returns its JSON, or nothing: no connection, no answer
 * in time, a failure status other than 400, a body that stops part way, one too large, or one that isn't JSON.
 * Always a POST, because a router logs a GET's address (C-55). Nothing from the browser's request
 * is passed on: no header, no cookie and no address.
 */
export const createPostGraphql =
  ({ url, fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: Options): PostGraphql =>
  async (body) => {
    try {
      const response = await fetch(`${url}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        // A router never redirects, so a redirect means the address is wrong.
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      // A router answers an operation it refuses before running, such as one over a limit, with
      // 400 and a GraphQL body. Anything else that isn't a success has no body worth reading.
      const readable = response.ok || response.status === 400;
      const text = readable ? await readCapped(response.body, MAX_BYTES) : undefined;
      return text === undefined ? undefined : (JSON.parse(text) as unknown);
    } catch {
      return undefined;
    }
  };
