import { execFileSync } from "node:child_process";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLimits, createRedisCounter } from "../../src/server/assistant/limits.ts";

/** The pinned image, by digest, so a moved tag can't change what's tested. Redis 7.4.12. */
const REDIS_IMAGE = "redis@sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe";
const PORT = 6390;
const NAME = `traverse-redis-test-${String(process.pid)}`;
const URL = `redis://127.0.0.1:${String(PORT)}`;

let probe: Redis;

beforeAll(async () => {
  execFileSync("docker", [
    ...["run", "--detach", "--rm", "--name", NAME],
    ...["--publish", `127.0.0.1:${String(PORT)}:6379`, REDIS_IMAGE],
  ]);
  probe = new Redis(URL, { lazyConnect: true });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (
      await probe.connect().then(
        () => true,
        () => false,
      )
    )
      return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error("Redis never became ready");
}, 60_000);

afterAll(() => {
  probe.disconnect();
  execFileSync("docker", ["rm", "--force", NAME], { stdio: "ignore" });
});

describe("the AI call counter on Redis", () => {
  it("[GR-15] counts across clients, and sets the key to lapse once, on its first call", async () => {
    const first = createRedisCounter(URL);
    const second = createRedisCounter(URL);

    expect(await first.increment("ai:test:shared", 100)).toBe(1);
    const ttl = await probe.ttl("ai:test:shared");
    expect(await second.increment("ai:test:shared", 5)).toBe(2);

    expect(ttl).toBeGreaterThan(90);
    // A later call's shorter lapse doesn't shorten the day already set (EXPIRE NX).
    expect(await probe.ttl("ai:test:shared")).toBeGreaterThan(90);
  });

  it("[GR-15] holds a user to the limit across server instances", async () => {
    const one = createLimits({ counter: createRedisCounter(URL), perUser: 2 });
    const two = createLimits({ counter: createRedisCounter(URL), perUser: 2 });

    expect(await one.take("test-user")).toBe("ok");
    expect(await two.take("test-user")).toBe("ok");
    expect(await one.take("test-user")).toBe("user-limit");
  });
});
