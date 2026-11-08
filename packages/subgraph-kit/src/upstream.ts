import { GraphQLError } from "graphql";
import { z } from "zod";
import type { Cache } from "./cache.ts";
import { createLimiter, LimitReached } from "./limiter.ts";
import { MAX_REPRESENTATIONS } from "./limits.ts";
import { createLogger, type Logger } from "./logging.ts";
import {
  requestJson,
  type FailureReason,
  type Outcome,
  type UpstreamFetch,
  type UpstreamRequest,
} from "./request.ts";

/** Says which source failed and nothing else, so no URL, token or upstream text reaches a client. */
export const upstreamError = (source: string): GraphQLError =>
  new GraphQLError(`${source} is unavailable.`, {
    extensions: { code: "UPSTREAM_UNAVAILABLE", source },
  });

/** For input that can't be answered, where an empty result would read as a real one. */
export const invalidInput = (message: string): GraphQLError =>
  new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });

export interface CachePolicy {
  freshSeconds: number;
  staleSeconds: number;
}

export interface UpstreamCall<T> {
  /** Names the answer, not the URL: requests that share a URL can need different answers. */
  key: string;
  policy: (value: T | null) => CachePolicy;
  request: UpstreamRequest<T>;
  /**
   * The shape of the answer, checked again when it's read back from the cache. Anyone who can
   * write to Redis could otherwise serve anything, such as an empty advisory list for good.
   */
  stored: z.ZodType<T>;
}

export interface Upstream {
  call: <T>(call: UpstreamCall<T>) => Promise<T | null>;
}

export interface UpstreamOptions {
  source: string;
  fetch: UpstreamFetch;
  cache: Cache | undefined;
  logger: () => Logger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  concurrency?: number;
  queueLimit?: number;
}

interface Entry<T> {
  value: T | null;
  storedAt: number;
}

const silent = createLogger("upstream", "silent", undefined);

// Bumped when a schema's output changes, so old entries are never read as the new shape.
const CACHE_VERSION = 1;
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 5000;
const DEADLINE_MS = 20_000;
const DEFAULT_TIMEOUT_MS = 5000;

// After a 429 with no hint, how long a source is left alone, so other keys don't spend its budget.
const COOL_DOWN_MS = 30_000;

const isRetryable = (reason: FailureReason): boolean =>
  reason === "timeout" || reason === "network" || /^status-(?:429|5\d\d)$/.test(reason);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

type Warn = (reason: string, message: string) => unknown;

const entrySchema = z.object({ value: z.unknown(), storedAt: z.number().finite() });

const parseStored = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// A cache that's down is a miss, never a failure: Redis only makes things faster.
const createCacheAccess = (cache: Cache | undefined, warn: Warn, now: () => number) => ({
  read: async <T>(key: string, stored: z.ZodType<T>): Promise<Entry<T> | undefined> => {
    let text: string | null | undefined;
    try {
      text = await cache?.get(key);
    } catch {
      warn("cache-unavailable", "cache read failed");
      return undefined;
    }
    if (!text) return undefined;
    const entry = entrySchema.safeParse(parseStored(text));
    const value = entry.success ? stored.nullable().safeParse(entry.data.value) : undefined;
    if (!entry.success || !value?.success || entry.data.storedAt > now()) {
      warn("cache-invalid", "cache entry ignored");
      return undefined;
    }
    return { value: value.data, storedAt: entry.data.storedAt };
  },
  write: async <T>(key: string, entry: Entry<T>, ttlSeconds: number): Promise<void> => {
    try {
      await cache?.set(key, JSON.stringify(entry), ttlSeconds);
    } catch {
      warn("cache-unavailable", "cache write failed");
    }
  },
});

interface Attempts {
  run: <T>(request: UpstreamRequest<T>, started: number) => Promise<Outcome<T>>;
}

/**
 * Retries a failure that may pass, within one deadline that also counts time spent queueing. A wait
 * longer than the cap means the source asked for more than a request can give, so it stops there.
 * A 429 pauses the whole source, so other keys don't spend what's left of its budget.
 */
const createAttempts = (
  fetch: UpstreamFetch,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Attempts => {
  let coolingUntil = 0;

  const coolDown = (outcome: Outcome<unknown>): void => {
    if (outcome.kind === "failed" && outcome.reason === "status-429") {
      coolingUntil = now() + (outcome.retryAfterMs ?? COOL_DOWN_MS);
    }
  };

  // How long the next try may take, or why there's no point trying.
  const budget = (request: UpstreamRequest<unknown>, started: number): number | FailureReason => {
    if (now() < coolingUntil) return "cooling-down";
    const left = DEADLINE_MS - (now() - started);
    const timeoutMs = Math.min(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, left);
    return timeoutMs > 0 ? timeoutMs : "timeout";
  };

  const run = async <T>(request: UpstreamRequest<T>, started: number): Promise<Outcome<T>> => {
    for (let tries = 1; ; tries += 1) {
      const timeoutMs = budget(request, started);
      if (typeof timeoutMs === "string") return { kind: "failed", reason: timeoutMs };
      const outcome = await requestJson(fetch, { ...request, timeoutMs });
      coolDown(outcome);
      if (outcome.kind !== "failed" || !isRetryable(outcome.reason) || tries >= MAX_ATTEMPTS) {
        return outcome;
      }
      const delay = outcome.retryAfterMs ?? BASE_DELAY_MS * 2 ** (tries - 1);
      if (delay > MAX_DELAY_MS || now() - started + delay >= DEADLINE_MS) return outcome;
      await sleep(delay);
    }
  };

  return { run };
};

export const createUpstream = ({
  source,
  fetch,
  cache,
  logger,
  now = Date.now,
  sleep = defaultSleep,
  concurrency = 4,
  queueLimit = MAX_REPRESENTATIONS,
}: UpstreamOptions): Upstream => {
  const limiter = createLimiter(concurrency, queueLimit);
  const inFlight = new Map<string, Promise<unknown>>();
  const warn: Warn = (reason, message) => logger().warn({ source, reason }, message);
  const store = createCacheAccess(cache, warn, now);
  const attempts = createAttempts(fetch, now, sleep);
  const age = (entry: Entry<unknown>): number => now() - entry.storedAt;

  const limited = async <T>(request: UpstreamRequest<T>): Promise<Outcome<T>> => {
    const started = now();
    try {
      return await limiter.run(() => attempts.run(request, started));
    } catch (error) {
      if (error instanceof LimitReached) return { kind: "failed", reason: "queue-full" };
      throw error;
    }
  };

  const refresh = async <T>(
    { policy, request }: UpstreamCall<T>,
    key: string,
    cached: Entry<T> | undefined,
  ): Promise<T | null> => {
    const outcome = await limited(request);
    if (outcome.kind !== "failed") {
      const value = outcome.kind === "ok" ? outcome.value : null;
      // Not awaited: a slow Redis shouldn't hold up everyone waiting on this key.
      void store.write(key, { value, storedAt: now() }, policy(value).staleSeconds);
      return value;
    }
    warn(outcome.reason, "upstream failed");
    if (!cached || age(cached) >= policy(cached.value).staleSeconds * 1000) {
      throw upstreamError(source);
    }
    warn(outcome.reason, "serving a stale answer");
    return cached.value;
  };

  /**
   * A fresh answer comes from the cache. Otherwise one call goes upstream however many requests
   * want the same key, and if it fails, a stale answer is better than none (FR-SG-6).
   */
  const call = async <T>(upstreamCall: UpstreamCall<T>): Promise<T | null> => {
    // The origin keeps a local stand-in's answers apart from the real source's, if they share Redis.
    const { origin } = new URL(upstreamCall.request.url);
    const key = `${source}:v${CACHE_VERSION}:${origin}:${upstreamCall.key}`;
    const cached = await store.read(key, upstreamCall.stored);
    if (cached && age(cached) < upstreamCall.policy(cached.value).freshSeconds * 1000) {
      return cached.value;
    }
    const pending = inFlight.get(key) ?? refresh(upstreamCall, key, cached);
    inFlight.set(key, pending);
    try {
      return (await pending) as T | null;
    } finally {
      inFlight.delete(key);
    }
  };

  return { call };
};

/** For scripts that check sources directly: no cache, no logs. */
export const createDirectUpstream = (source: string, fetch: UpstreamFetch): Upstream =>
  createUpstream({ source, fetch, cache: undefined, logger: () => silent });

/** An answer, or a known absence, which is kept for less time because it may soon change. */
export const cachePolicy =
  ({ fresh, stale, missing }: { fresh: number; stale: number; missing: number }) =>
  (value: unknown): CachePolicy =>
    value === null
      ? { freshSeconds: missing, staleSeconds: missing }
      : { freshSeconds: fresh, staleSeconds: stale };

/** One line per problem, naming the check and never quoting the source's answer. */
export const expectLive = async <T>(
  label: string,
  run: () => Promise<T>,
  isHealthy: (value: T) => boolean,
): Promise<string[]> => {
  try {
    return isHealthy(await run()) ? [] : [`${label}: unexpected answer`];
  } catch {
    return [`${label}: failed`];
  }
};
