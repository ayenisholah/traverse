import { createHash } from "node:crypto";
import { Redis } from "ioredis";

export interface Counter {
  /** Adds one to `key`, which lapses after `ttlSeconds`, and returns the new count. */
  increment: (key: string, ttlSeconds: number) => Promise<number>;
}

export type LimitCheck = "ok" | "user-limit" | "global-limit" | "unavailable";

export interface Limits {
  /** Counts one call for the user, and says whether it may go ahead (GR-15). */
  take: (userId: string) => Promise<LimitCheck>;
}

interface Options {
  counter: Counter;
  perUser?: number;
  global?: number;
  now?: () => number;
}

const PER_USER_DAILY = 50;
const GLOBAL_DAILY = 2_000;
const DAY_SECONDS = 24 * 60 * 60;

// The counter holds a digest, so Redis never holds a user's subject.
const userKey = (userId: string) => createHash("sha256").update(userId).digest("hex").slice(0, 32);

/**
 * Calls per user and in all, per UTC day. Every call counts, even one the model then fails, so a
 * failing model can't be hammered. If the counter can't be reached, nobody may call: the limit is
 * what bounds spend, so it fails closed.
 */
export const createLimits = ({
  counter,
  perUser = PER_USER_DAILY,
  global = GLOBAL_DAILY,
  now = Date.now,
}: Options): Limits => ({
  take: async (userId) => {
    const day = new Date(now()).toISOString().slice(0, 10);
    try {
      // The user's own count first, so someone past their limit can't use up everyone's.
      const mine = await counter.increment(`ai:user:${userKey(userId)}:${day}`, DAY_SECONDS);
      if (mine > perUser) return "user-limit";
      const all = await counter.increment(`ai:all:${day}`, DAY_SECONDS);
      return all > global ? "global-limit" : "ok";
    } catch {
      return "unavailable";
    }
  },
});

/**
 * A counter in Redis. A call made while it connects waits for the connection, unlike the subgraphs'
 * cache, because a miss there is harmless and a failed count here refuses the call. Each call
 * still gives up after a short timeout, and the limit then fails closed.
 */
export const createRedisCounter = (url: string): Counter => {
  const client = new Redis(url, {
    enableOfflineQueue: true,
    maxRetriesPerRequest: 0,
    connectTimeout: 1000,
    commandTimeout: 500,
  });
  // Without a listener, a connection error would end the process. Each call reports its own.
  client.on("error", () => undefined);
  return {
    increment: async (key, ttlSeconds) => {
      const results = await client.multi().incr(key).expire(key, ttlSeconds, "NX").exec();
      const [increment, expire] = results ?? [];
      // A missing reply, or an error in either step, is no count.
      if (!increment || !expire || increment[0] || expire[0]) throw new Error("counter failed");
      return increment[1] as number;
    },
  };
};
