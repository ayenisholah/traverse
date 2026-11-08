import { afterEach, describe, expect, it } from "vitest";
import { createRedisCache } from "../src/cache.ts";
import { hangingRedis } from "./support/fake-redis.ts";

const servers: { close: () => void }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe("createRedisCache", () => {
  it("[FR-SG-6] fails fast when Redis can't be reached, rather than hold up a request", async () => {
    // Port 1 refuses connections, which is what a down Redis looks like.
    const cache = createRedisCache("redis://127.0.0.1:1");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const started = performance.now();

    await expect(cache.get("k")).rejects.toThrow();
    await expect(cache.set("k", "v", 10)).rejects.toThrow();

    expect(performance.now() - started).toBeLessThan(500);
    await cache.close();
  });

  it("[FR-SG-6] gives up on a Redis that connects and then hangs", async () => {
    const { url, server } = await hangingRedis();
    servers.push(server);
    const cache = createRedisCache(url);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const started = performance.now();

    await expect(cache.get("k")).rejects.toThrow(/timed out/i);

    expect(performance.now() - started).toBeGreaterThanOrEqual(400);
    expect(performance.now() - started).toBeLessThan(1500);
    await cache.close();
  });

  it("[FR-SG-6] closes its connection", async () => {
    const { url, closed, server } = await hangingRedis();
    servers.push(server);
    const cache = createRedisCache(url);
    await new Promise((resolve) => setTimeout(resolve, 100));

    await cache.close();

    await expect(closed).resolves.toBe(false);
  });
});
