import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { requestJson, retryAfterMs } from "../src/request.ts";

const schema = z.object({ value: z.string() });
const request = { url: "https://upstream.example/thing", schema };

const answer =
  (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers }));

describe("requestJson", () => {
  it("[FR-SG-7] returns the parsed body, dropping fields the schema doesn't name", async () => {
    expect(await requestJson(answer({ value: "kept", email: "dropped" }), request)).toEqual({
      kind: "ok",
      value: { value: "kept" },
    });
  });

  it("[FR-SG-7] identifies itself, refuses redirects and sets a timeout", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(answer({ value: "x" }));
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await requestJson(fetch, { ...request, headers: { accept: "text/plain" } });

    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({ accept: "text/plain", "user-agent": "traverse" });
    expect(init?.redirect).toBe("error");
    expect(timeout).toHaveBeenCalledWith(5000);
  });

  it("[FR-SG-7] sends a method and body when given them", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(answer({ value: "x" }));

    await requestJson(fetch, { ...request, method: "POST", body: "{}", timeoutMs: 15_000 });

    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: "{}" });
  });

  it("[FR-SG-7] reads 404 as nothing there, unless the endpoint always exists", async () => {
    const missing = answer("Not Found", 404);

    expect(await requestJson(missing, request)).toEqual({ kind: "missing" });
    expect(await requestJson(missing, { ...request, notFoundIsFailure: true })).toEqual({
      kind: "failed",
      reason: "status-404",
    });
  });

  it.each<[string, typeof globalThis.fetch, string]>([
    ["a server error", answer({ value: "valid" }, 503), "status-503"],
    ["an empty body", () => Promise.resolve(new Response(null)), "invalid-response"],
    ["an unexpected shape", answer({ value: 42 }), "invalid-response"],
    ["text that isn't JSON", () => Promise.resolve(new Response("<html>")), "invalid-response"],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed")), "network"],
    [
      "a timeout",
      () => Promise.reject(Object.assign(new Error("slow"), { name: "TimeoutError" })),
      "timeout",
    ],
    [
      "a response too large to parse safely",
      () => Promise.resolve(new Response(JSON.stringify({ value: "x".repeat(16_000_001) }))),
      "too-large",
    ],
  ])("[FR-SG-7] reports %s with a fixed reason", async (_, fetch, reason) => {
    expect(await requestJson(fetch, request)).toEqual({ kind: "failed", reason });
  });

  it("[FR-SG-7] gives up when a source hangs", async () => {
    const hangs: typeof globalThis.fetch = (_, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason as Error);
        });
      });

    expect(await requestJson(hangs, { ...request, timeoutMs: 10 })).toEqual({
      kind: "failed",
      reason: "timeout",
    });
  });

  it("[FR-SG-6] passes on how long a source asked to wait", async () => {
    const limited = answer({}, 429, { "retry-after": "3" });

    expect(await requestJson(limited, request)).toEqual({
      kind: "failed",
      reason: "status-429",
      retryAfterMs: 3000,
    });
  });
});

describe("retryAfterMs", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");

  it.each<[string | null, number | undefined]>([
    ["2", 2000],
    ["0", 0],
    ["Sun, 08 Nov 2026 12:00:05 GMT", 5000],
    ["Sun, 08 Nov 2026 11:00:00 GMT", 0],
    ["-4", 0],
    ["soon", undefined],
    ["", undefined],
    [null, undefined],
  ])("[FR-SG-6] reads %j as %j", (header, expected) => {
    expect(retryAfterMs(header, now)).toBe(expected);
  });
});
