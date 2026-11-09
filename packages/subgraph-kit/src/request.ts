import type { z } from "zod";

export type UpstreamFetch = typeof globalThis.fetch;

export interface UpstreamRequest<T> {
  url: string;
  schema: z.ZodType<T>;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** A GraphQL endpoint always exists, so a 404 from one means the address is wrong. */
  notFoundIsFailure?: boolean;
}

/** Fixed strings only, so a log line can say why without quoting a URL, a body or a token. */
export type FailureReason =
  | "timeout"
  | "network"
  | "too-large"
  | "invalid-response"
  | "queue-full"
  | "cooling-down"
  | `status-${number}`;

export type Outcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "missing" }
  | { kind: "failed"; reason: FailureReason; retryAfterMs?: number };

const DEFAULT_TIMEOUT_MS = 5000;

// Twice the largest real document seen, npm's 8.8 MB for `typescript`. Parsing far more than this
// can exhaust the heap, which would take every request in flight with it.
const MAX_RESPONSE_BYTES = 16_000_000;

class TooLarge extends Error {}

const failed = (reason: FailureReason, retryAfterMs?: number): Outcome<never> =>
  retryAfterMs === undefined
    ? { kind: "failed", reason }
    : { kind: "failed", reason, retryAfterMs };

const reasonFor = (error: unknown): FailureReason => {
  if (error instanceof TooLarge) return "too-large";
  return (error as Error).name === "TimeoutError" ? "timeout" : "network";
};

const readBody = async (response: Response): Promise<string> => {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    size += part.value.length;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new TooLarge();
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// A source's answer sets how long the whole source is left alone, so a huge value, or one that
// overflows to Infinity, would stop it until restart. A minute is longer than any real hint seen.
const MAX_RETRY_AFTER_MS = 60_000;

const bounded = (ms: number): number => Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));

/** Seconds or an HTTP date, as `Retry-After` allows, up to a minute. Anything else gives no hint. */
export const retryAfterMs = (header: string | null, now: number): number | undefined => {
  if (header === null || header.trim() === "") return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return bounded(seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : bounded(date - now);
};

/**
 * Upstream text is untrusted, so the schema decides what gets past this point. Each schema must
 * also clean what it keeps, because this result is what gets cached (GR-13, GR-16). Redirects are
 * refused, so a source can't send a request somewhere else.
 */
export const requestJson = async <T>(
  fetch: UpstreamFetch,
  {
    url,
    schema,
    headers,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    notFoundIsFailure = false,
    ...init
  }: UpstreamRequest<T>,
): Promise<Outcome<T>> => {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { ...headers, "user-agent": "traverse" },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 404 && !notFoundIsFailure) return { kind: "missing" };
    if (!response.ok) {
      const hint = retryAfterMs(response.headers.get("retry-after"), Date.now());
      return failed(`status-${response.status}`, hint);
    }
    const parsed = schema.safeParse(parseJson(await readBody(response)));
    return parsed.success ? { kind: "ok", value: parsed.data } : failed("invalid-response");
  } catch (error) {
    return failed(reasonFor(error));
  }
};
