import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Cache } from "../src/cache.ts";
import {
  cachePolicy,
  createDirectUpstream,
  expectLive,
  createUpstream,
  invalidInput,
  upstreamError,
  type CachePolicy,
} from "../src/index.ts";
import { createLogger } from "../src/logging.ts";

const schema = z.object({ value: z.string() });
const policy = (): CachePolicy => ({ freshSeconds: 60, staleSeconds: 600 });
const silent = createLogger("test", "silent", undefined);

const memoryCache = () => {
  const store = new Map<string, { value: string; ttl: number }>();
  const cache: Cache = {
    get: (key) => Promise.resolve(store.get(key)?.value ?? null),
    set: (key, value, ttl) => {
      store.set(key, { value, ttl });
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
  return { cache, store };
};

const brokenCache: Cache = {
  get: () => Promise.reject(new Error("redis down")),
  set: () => Promise.reject(new Error("redis down")),
  close: () => Promise.resolve(),
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

interface SetupOptions {
  responses?: (() => Response | Promise<Response>)[];
  cache?: Cache | null;
  concurrency?: number;
  queueLimit?: number;
}

const setup = ({
  responses = [],
  cache = memoryCache().cache,
  concurrency = 4,
  queueLimit = 100,
}: SetupOptions = {}) => {
  let clock = Date.parse("2026-11-08T12:00:00Z");
  const logs: string[] = [];
  const sleeps: number[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(() => {
    const next = responses.shift();
    return next ? Promise.resolve(next()) : Promise.resolve(json({ value: "default" }));
  });
  const upstream = createUpstream({
    source: "npm",
    fetch,
    cache: cache ?? undefined,
    logger: () => createLogger("test", "info", { write: (line: string) => void logs.push(line) }),
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    concurrency,
    queueLimit,
  });
  const call = (key = "ms", custom: (value: unknown) => CachePolicy = policy) =>
    upstream.call({
      key,
      policy: custom,
      stored: schema,
      request: { url: "https://npm.example/ms", schema },
    });
  return {
    call,
    fetch,
    logs,
    sleeps,
    advance: (seconds: number) => {
      clock += seconds * 1000;
    },
  };
};

describe("createUpstream", () => {
  it("[FR-SG-6] serves a fresh answer from the cache, with no upstream call", async () => {
    const { call, fetch } = setup({ responses: [() => json({ value: "first" })] });

    expect(await call()).toEqual({ value: "first" });
    expect(await call()).toEqual({ value: "first" });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("[FR-SG-6] asks again once an answer stops being fresh", async () => {
    const { call, fetch, advance } = setup({
      responses: [() => json({ value: "first" }), () => json({ value: "second" })],
    });

    await call();
    advance(61);

    expect(await call()).toEqual({ value: "second" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("[FR-SG-6] stores the answer for its stale lifetime, under a key naming the source", async () => {
    const { cache, store } = memoryCache();
    const { call } = setup({ cache });

    await call("lodash@4.17.20");

    const key = "npm:v1:https://npm.example:lodash@4.17.20";
    expect([...store.keys()]).toEqual([key]);
    expect(store.get(key)).toMatchObject({ ttl: 600 });
    expect(store.get(key)?.value).toContain('"value":"default"');
  });

  it("[FR-SG-6] keeps different keys apart, even with the same URL", async () => {
    const { call, fetch } = setup({
      responses: [() => json({ value: "a" }), () => json({ value: "b" })],
    });

    expect(await call("a")).toEqual({ value: "a" });
    expect(await call("b")).toEqual({ value: "b" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("[FR-SG-6] remembers that nothing is there, for the policy's time", async () => {
    const { cache, store } = memoryCache();
    const { call, fetch } = setup({ cache, responses: [() => json("Not Found", 404)] });
    const short = (value: unknown): CachePolicy =>
      value === null ? { freshSeconds: 5, staleSeconds: 10 } : policy();

    expect(await call("ms", short)).toBeNull();
    expect(await call("ms", short)).toBeNull();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get("npm:v1:https://npm.example:ms")?.ttl).toBe(10);
  });

  it("[FR-SG-6] serves a stale answer when the source fails, and says so in the log", async () => {
    const { call, advance, logs } = setup({
      responses: [
        () => json({ value: "old" }),
        ...Array.from({ length: 3 }, () => () => json({}, 503)),
      ],
    });

    await call();
    advance(120);

    expect(await call()).toEqual({ value: "old" });
    expect(logs.join("\n")).toContain('"reason":"status-503"');
    expect(logs.join("\n")).toContain("serving a stale answer");
  });

  it("[FR-SG-6] fails once a stale answer is too old to serve", async () => {
    const { call, advance } = setup({
      responses: [
        () => json({ value: "old" }),
        ...Array.from({ length: 3 }, () => () => json({}, 503)),
      ],
    });

    await call();
    advance(601);

    await expect(call()).rejects.toMatchObject({ message: "npm is unavailable." });
  });

  it("[FR-SG-6] never stores a failure", async () => {
    const { cache, store } = memoryCache();
    const { call } = setup({
      cache,
      responses: Array.from({ length: 3 }, () => () => json({}, 503)),
    });

    await expect(call()).rejects.toThrow();

    expect(store.size).toBe(0);
  });

  it("[FR-SG-6] retries a server error, waiting longer each time", async () => {
    const { call, fetch, sleeps } = setup({
      responses: [() => json({}, 503), () => json({}, 502), () => json({ value: "third" })],
    });

    expect(await call()).toEqual({ value: "third" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([250, 500]);
  });

  it("[FR-SG-6] stops after three tries", async () => {
    const { call, fetch } = setup({
      responses: Array.from({ length: 5 }, () => () => json({}, 503)),
    });

    await expect(call()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("[FR-SG-6] waits as long as a rate limit asks", async () => {
    const { call, sleeps } = setup({
      responses: [() => json({}, 429, { "retry-after": "2" }), () => json({ value: "ok" })],
    });

    expect(await call()).toEqual({ value: "ok" });
    expect(sleeps).toEqual([2000]);
  });

  it("[FR-SG-6] gives up when a source asks to wait longer than a request can", async () => {
    const { call, fetch, sleeps } = setup({
      responses: [() => json({}, 429, { "retry-after": "10" }), () => json({ value: "ok" })],
    });

    await expect(call()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("[FR-SG-6] leaves a rate-limited source alone, for every key, until it cools down", async () => {
    const { call, fetch, advance, logs } = setup({
      responses: [() => json({}, 429), () => json({ value: "later" })],
    });

    await expect(call("a")).rejects.toThrow();
    await expect(call("b")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).toContain('"reason":"cooling-down"');

    advance(31);
    expect(await call("c")).toEqual({ value: "later" });
  });

  it("[FR-SG-6] tries again after a minute, however long a rate limit asks to wait", async () => {
    const { call, fetch, advance } = setup({
      responses: [() => json({}, 429, { "retry-after": "1e308" }), () => json({ value: "later" })],
    });

    await expect(call("a")).rejects.toThrow();
    advance(59);
    await expect(call("b")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);

    advance(2);
    expect(await call("c")).toEqual({ value: "later" });
  });

  it("[FR-SG-6] gives each try only the time left before the deadline", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { call, advance } = setup({
      responses: [
        () => {
          advance(17);
          return json({}, 503);
        },
        () => json({ value: "ok" }),
      ],
    });

    await call();

    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([5000, 2750]);
  });

  it("[FR-SG-6] gives up on a request that waited in the queue past its deadline", async () => {
    let clock = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      clock += 21_000;
      return Promise.resolve(json({ value: "slow" }));
    });
    const upstream = createUpstream({
      source: "npm",
      fetch,
      cache: undefined,
      logger: () => silent,
      now: () => clock,
      concurrency: 1,
    });
    const call = (key: string) =>
      upstream.call({
        key,
        policy,
        stored: schema,
        request: { url: "https://npm.example", schema },
      });

    const [first, second] = await Promise.allSettled([call("a"), call("b")]);

    expect(first).toMatchObject({ status: "fulfilled" });
    expect(second).toMatchObject({ status: "rejected" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("[FR-SG-6] stops once the deadline has passed", async () => {
    const { call, fetch, advance } = setup({
      responses: [
        () => {
          advance(19.75);
          return json({}, 503);
        },
      ],
    });

    await expect(call()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("[FR-SG-6] won't wait past its deadline", async () => {
    const { call, fetch, sleeps, advance } = setup({
      responses: [
        () => {
          advance(19.9);
          return json({}, 503);
        },
        () => json({ value: "late" }),
      ],
    });

    await expect(call()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it.each([404, 400, 401, 403])("[FR-SG-6] doesn't retry a %i", async (status) => {
    const { call, fetch } = setup({ responses: [() => json({}, status)] });

    await call().catch(() => undefined);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("[FR-SG-6] doesn't retry an answer that fails its schema", async () => {
    const { call, fetch } = setup({ responses: [() => json({ value: 1 })] });

    await expect(call()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a timeout", () => Promise.reject(Object.assign(new Error(), { name: "TimeoutError" }))],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
  ])("[FR-SG-6] retries %s", async (_, failure) => {
    const { call } = setup();
    let first = true;
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      if (!first) return Promise.resolve(json({ value: "ok" }));
      first = false;
      return failure();
    });
    const upstream = createUpstream({
      source: "npm",
      fetch,
      cache: undefined,
      logger: () => createLogger("test", "silent", undefined),
      sleep: () => Promise.resolve(),
    });

    const value = await upstream.call({
      key: "k",
      policy,
      stored: schema,
      request: { url: "https://npm.example/ms", schema },
    });

    expect(value).toEqual({ value: "ok" });
    expect(call).toBeDefined();
  });

  it("[FR-SG-6] makes one upstream call for many identical requests at once", async () => {
    let release: (response: Response) => void = () => undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const upstream = createUpstream({
      source: "GitHub",
      fetch,
      cache: undefined,
      logger: () => createLogger("test", "silent", undefined),
    });
    const request = { url: "https://api.example", schema };

    const calls = Array.from({ length: 5000 }, () =>
      upstream.call({ key: "same", policy, stored: schema, request }),
    );
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    release(json({ value: "shared" }));

    const results = await Promise.all(calls);
    expect(new Set(results.map((result) => JSON.stringify(result)))).toEqual(
      new Set(['{"value":"shared"}']),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("[FR-SG-6] fails extra work once the queue is full, instead of calling upstream", async () => {
    const logs: string[] = [];
    const pending: ((response: Response) => void)[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    const upstream = createUpstream({
      source: "GitHub",
      fetch,
      cache: undefined,
      logger: () => createLogger("test", "info", { write: (line: string) => void logs.push(line) }),
      sleep: () => Promise.resolve(),
      concurrency: 1,
      queueLimit: 1,
    });
    const call = (key: string) =>
      upstream.call({
        key,
        policy,
        stored: schema,
        request: { url: "https://api.example", schema },
      });

    const first = call("a");
    const queued = call("b");
    const refused = call("c");

    await expect(refused).rejects.toMatchObject({ message: "GitHub is unavailable." });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).toContain('"reason":"queue-full"');
    await vi.waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    pending.shift()?.(json({ value: "a" }));
    await vi.waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    pending.shift()?.(json({ value: "b" }));
    expect(await first).toEqual({ value: "a" });
    expect(await queued).toEqual({ value: "b" });
  });

  it("[FR-SG-6] works without a cache when Redis is down, and logs it", async () => {
    const { call, fetch, logs } = setup({ cache: brokenCache });

    expect(await call()).toEqual({ value: "default" });
    expect(await call()).toEqual({ value: "default" });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(logs.join("\n")).toContain('"reason":"cache-unavailable"');
  });

  it.each([
    ["a stored time in the future", { value: { value: "forged" }, storedAt: 8.64e15 }],
    ["a value of the wrong shape", { value: { other: "x" }, storedAt: 0 }],
    ["an entry with no time", { value: { value: "x" } }],
    ["an entry that isn't an object", "text"],
  ])("[FR-SG-6] ignores %s, rather than trust whatever Redis holds", async (_, entry) => {
    const { cache, store } = memoryCache();
    store.set("npm:v1:https://npm.example:ms", { value: JSON.stringify(entry), ttl: 1 });
    const { call, fetch, logs } = setup({ cache });

    expect(await call()).toEqual({ value: "default" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).toContain('"reason":"cache-invalid"');
  });

  it("[FR-SG-6] keeps a stand-in's answers apart from the real source's", async () => {
    const { cache, store } = memoryCache();
    const fetch = () => Promise.resolve(json({ value: "x" }));
    const upstream = createUpstream({ source: "OSV", fetch, cache, logger: () => silent });

    for (const url of ["https://api.osv.dev/v1/query", "http://replay/v1/query"]) {
      await upstream.call({ key: "k", policy, stored: schema, request: { url, schema } });
    }

    expect([...store.keys()]).toEqual(["OSV:v1:https://api.osv.dev:k", "OSV:v1:http://replay:k"]);
  });

  it("[FR-SG-6] answers without waiting for a slow cache write", async () => {
    const hangingWrite: Cache = {
      get: () => Promise.resolve(null),
      set: () => new Promise(() => undefined),
      close: () => Promise.resolve(),
    };
    const { call } = setup({ cache: hangingWrite });

    expect(await call()).toEqual({ value: "default" });
  });

  it("[FR-SG-6] treats an unreadable entry as a miss", async () => {
    const { cache, store } = memoryCache();
    store.set("npm:v1:https://npm.example:ms", { value: "{not json", ttl: 1 });
    const { call, fetch } = setup({ cache });

    expect(await call()).toEqual({ value: "default" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("[FR-SG-6] works with no cache at all", async () => {
    const { call, fetch } = setup({ cache: null });

    await call();
    await call();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("[GR-4] logs the source and reason, never the URL or body", async () => {
    const { call, logs } = setup({
      responses: [() => json({ secret: "private-body" }, 401)],
    });

    await call().catch(() => undefined);

    const output = logs.join("\n");
    expect(output).toContain('"source":"npm"');
    expect(output).toContain('"reason":"status-401"');
    expect(output).not.toContain("npm.example");
    expect(output).not.toContain("private-body");
  });

  it("[FR-SG-6] passes on a fault that isn't the queue limit", async () => {
    const upstream = createUpstream({
      source: "npm",
      fetch: () => Promise.resolve(json({ value: "x" })),
      cache: undefined,
      logger: () => createLogger("test", "silent", undefined),
      now: (() => {
        let calls = 0;
        return () => {
          calls += 1;
          if (calls > 1) throw new Error("broken clock");
          return 0;
        };
      })(),
    });

    await expect(
      upstream.call({
        key: "k",
        policy,
        stored: schema,
        request: { url: "https://npm.example", schema },
      }),
    ).rejects.toThrow("broken clock");
  });
});

describe("createDirectUpstream", () => {
  it("[FR-SG-10] really waits between retries", async () => {
    const responses = [json({}, 503), json({ value: "x" })];
    const upstream = createDirectUpstream("npm", () =>
      Promise.resolve(responses.shift() as Response),
    );
    const started = performance.now();

    await upstream.call({
      key: "k",
      policy,
      stored: schema,
      request: { url: "https://npm.example", schema },
    });

    expect(performance.now() - started).toBeGreaterThanOrEqual(240);
  });

  it("[FR-SG-10] reports a failed source, quietly", async () => {
    const upstream = createDirectUpstream("npm", () => Promise.resolve(json({}, 401)));

    await expect(
      upstream.call({
        key: "k",
        policy,
        stored: schema,
        request: { url: "https://npm.example", schema },
      }),
    ).rejects.toMatchObject({ message: "npm is unavailable." });
  });

  it("[FR-SG-10] calls the source with no cache, for scripts", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(json({ value: "x" })));
    const upstream = createDirectUpstream("npm", fetch);
    const request = { url: "https://npm.example", schema };

    await upstream.call({ key: "k", policy, stored: schema, request });
    await upstream.call({ key: "k", policy, stored: schema, request });

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("errors", () => {
  it("[FR-SG-7] names the failed source and nothing else", () => {
    expect(upstreamError("OSV")).toMatchObject({
      message: "OSV is unavailable.",
      extensions: { code: "UPSTREAM_UNAVAILABLE", source: "OSV" },
    });
  });

  it("[FR-SG-7] marks bad input as the caller's", () => {
    expect(invalidInput("Bad.")).toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });
});

describe("cachePolicy", () => {
  it("[FR-SG-6] keeps a known absence for less time than an answer", () => {
    const policyFor = cachePolicy({ fresh: 60, stale: 600, missing: 5 });

    expect(policyFor({ value: "x" })).toEqual({ freshSeconds: 60, staleSeconds: 600 });
    expect(policyFor(null)).toEqual({ freshSeconds: 5, staleSeconds: 5 });
  });
});

describe("expectLive", () => {
  it.each<[string, () => Promise<number>, string[]]>([
    ["a healthy answer", () => Promise.resolve(5), []],
    ["an unexpected answer", () => Promise.resolve(0), ["npm latest: unexpected answer"]],
    ["a failure", () => Promise.reject(new Error("private detail")), ["npm latest: failed"]],
  ])("[FR-SG-10] reports %s", async (_, run, expected) => {
    expect(await expectLive("npm latest", run, (value) => value > 0)).toEqual(expected);
  });
});
