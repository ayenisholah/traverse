import { describe, expect, it, vi } from "vitest";
import { createPostGraphql } from "../../src/server/post-graphql.ts";

const answer = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

const post = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
  createPostGraphql({ url: "http://router.test", fetch, timeoutMs })({ query: "{ a }" });

const streamOf = (start: (controller: ReadableStreamDefaultController<Uint8Array>) => void) =>
  vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start })));

describe("createPostGraphql", () => {
  it("[GR-2] posts the body to the router's fixed address, with one header and nothing else", async () => {
    const fetch = answer({ data: {} });

    expect(await post(fetch)).toEqual({ data: {} });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://router.test/graphql");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init?.body as string)).toEqual({ query: "{ a }" });
  });

  it.each([
    ["a failure status", answer({ data: {} }, 503)],
    ["a body that isn't JSON", vi.fn<typeof fetch>(async () => new Response("<html>"))],
    ["no body", vi.fn<typeof fetch>(async () => new Response(null))],
    ["no answer at all", vi.fn<typeof fetch>(async () => Promise.reject(new Error("refused")))],
    [
      "an answer that stops part way",
      streamOf((controller) => {
        controller.error(new Error("reset"));
      }),
    ],
    ["an answer larger than any real one", answer({ data: "x".repeat(1_000_001) })],
  ])("returns nothing for %s", async (_, fetch) => {
    expect(await post(fetch)).toBeUndefined();
  });

  it("gives up on a router that doesn't answer in time", async () => {
    const hang = vi.fn<typeof fetch>(
      (_, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );

    expect(await post(hang, 10)).toBeUndefined();
  });

  it("reads an answer that arrives in pieces, even when a piece splits a character", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ data: { name: "é" } }));
    const split = bytes.indexOf(0xc3) + 1;
    const pieces = streamOf((controller) => {
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split));
      controller.close();
    });

    expect(await post(pieces)).toEqual({ data: { name: "é" } });
  });
});
