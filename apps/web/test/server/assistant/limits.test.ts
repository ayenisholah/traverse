import { describe, expect, it } from "vitest";
import {
  createLimits,
  createRedisCounter,
  type Counter,
} from "../../../src/server/assistant/limits.ts";
import { fakeRedis } from "../../support/fake-redis.ts";

const memoryCounter = (): Counter & { keys: () => string[] } => {
  const counts = new Map<string, number>();
  return {
    increment: (key) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return Promise.resolve(counts.get(key) as number);
    },
    keys: () => [...counts.keys()],
  };
};

const at = (iso: string) => () => Date.parse(iso);

describe("createLimits", () => {
  it("[GR-15] lets a user make their daily calls, then refuses the next", async () => {
    const limits = createLimits({ counter: memoryCounter(), perUser: 2, global: 10 });

    expect(await limits.take("ada")).toBe("ok");
    expect(await limits.take("ada")).toBe("ok");
    expect(await limits.take("ada")).toBe("user-limit");
    expect(await limits.take("grace")).toBe("ok");
  });

  it("[GR-15] refuses everyone once the day's calls in all are spent", async () => {
    const limits = createLimits({ counter: memoryCounter(), perUser: 10, global: 2 });
    await limits.take("ada");
    await limits.take("grace");

    expect(await limits.take("linus")).toBe("global-limit");
  });

  it("[GR-15] keeps someone past their own limit from using up everyone's", async () => {
    const limits = createLimits({ counter: memoryCounter(), perUser: 1, global: 3 });
    await limits.take("ada");
    for (let i = 0; i < 10; i += 1) await limits.take("ada");

    expect(await limits.take("grace")).toBe("ok");
    expect(await limits.take("linus")).toBe("ok");
  });

  it("[GR-15] starts each user again the next UTC day", async () => {
    const counter = memoryCounter();
    const today = createLimits({ counter, perUser: 1, now: at("2026-11-19T23:59:00Z") });
    const tomorrow = createLimits({ counter, perUser: 1, now: at("2026-11-20T00:01:00Z") });
    await today.take("ada");

    expect(await today.take("ada")).toBe("user-limit");
    expect(await tomorrow.take("ada")).toBe("ok");
  });

  it("[GR-14] keeps no user's subject in the counter", async () => {
    const counter = memoryCounter();
    await createLimits({ counter }).take("test-subject-1234");

    expect(counter.keys().join()).not.toContain("test-subject-1234");
  });

  it("[GR-15] lets nobody call when the counter can't be reached", async () => {
    const limits = createLimits({
      counter: { increment: () => Promise.reject(new Error("down")) },
    });

    expect(await limits.take("ada")).toBe("unavailable");
  });
});

describe("createRedisCounter", () => {
  it("[GR-15] counts with INCR and sets the key to lapse in the same transaction", async () => {
    const { url, server } = await fakeRedis("*2\r\n:3\r\n:1\r\n");

    expect(await createRedisCounter(url).increment("ai:all:2026-11-19", 86_400)).toBe(3);
    server.close();
  });

  it("[GR-15] fails when Redis refuses part of the transaction", async () => {
    const { url, server } = await fakeRedis("*2\r\n:3\r\n-ERR test refusal\r\n");

    await expect(createRedisCounter(url).increment("k", 60)).rejects.toThrow("counter failed");
    server.close();
  });

  it("[GR-15] fails when Redis aborts the transaction", async () => {
    const { url, server } = await fakeRedis("*-1\r\n");

    await expect(createRedisCounter(url).increment("k", 60)).rejects.toThrow("counter failed");
    server.close();
  });

  it("[GR-15] fails when Redis isn't there", async () => {
    await expect(createRedisCounter("redis://127.0.0.1:1").increment("k", 60)).rejects.toThrow();
  });
});
