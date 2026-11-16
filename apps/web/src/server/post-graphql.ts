const DEFAULT_TIMEOUT_MS = 10_000;
// Far above any answer the routers' limits allow, and far below what could exhaust memory.
const MAX_BYTES = 1_000_000;

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

export type PostGraphql = (body: unknown) => Promise<unknown>;

/**
 * Posts one GraphQL request to a router and returns its JSON, or nothing: no connection, no answer
 * in time, a failure status, a body that stops part way, one too large, or one that isn't JSON.
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
      const text = await readCapped(response);
      return text === undefined ? undefined : (JSON.parse(text) as unknown);
    } catch {
      return undefined;
    }
  };
