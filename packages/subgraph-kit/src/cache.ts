import { Redis } from "ioredis";

export interface Cache {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSeconds: number) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Fails fast rather than queueing, because a cache that waits for Redis to come back would hold up
 * every request. Callers treat a failure as a miss.
 */
export const createRedisCache = (url: string): Cache => {
  const client = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 1000,
    commandTimeout: 500,
  });
  // Without a listener, a connection error would end the process. Each call reports its own.
  client.on("error", () => undefined);
  return {
    get: (key) => client.get(key),
    set: async (key, value, ttlSeconds) => {
      await client.set(key, value, "EX", ttlSeconds);
    },
    close: async () => {
      client.disconnect();
      return Promise.resolve();
    },
  };
};
