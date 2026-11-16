import { describe, expect, it, vi } from "vitest";
import { PackageOperation } from "../../src/generated/operations.ts";
import { createRouterClient } from "../../src/server/router-client.ts";

const answer = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

const run = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
  createRouterClient({ url: "http://router.test", fetch, timeoutMs }).run(PackageOperation, {
    name: "express",
    version: null,
  });

describe("createRouterClient", () => {
  it("[FR-WB-12] sends the generated operation's hash and never its text", async () => {
    const fetch = answer({ data: { package: null } });

    await run(fetch);

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://router.test/graphql");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(JSON.parse(init?.body as string)).toEqual({
      variables: { name: "express", version: null },
      extensions: { persistedQuery: { version: 1, sha256Hash: PackageOperation.sha256 } },
    });
  });

  it("returns the router's data", async () => {
    const data = { package: { name: "express" } };

    expect(await run(answer({ data }))).toEqual({ ok: true, data, incomplete: false });
  });

  it("[FR-SG-6] marks an answer incomplete when a subgraph failed, and keeps the error text back", async () => {
    const data = { package: { name: "express", repository: null } };
    const result = await run(answer({ data, errors: [{ message: "upstream said: <script>" }] }));

    expect(result).toEqual({ ok: true, data, incomplete: true });
    expect(JSON.stringify(result)).not.toContain("upstream said");
  });

  it("[GR-2] sends nothing but the hash and the variables: one header, and a fixed address", async () => {
    const fetch = answer({ data: { package: null } });

    await run(fetch);

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://router.test/graphql");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(Object.keys(JSON.parse(init?.body as string) as object)).toEqual([
      "variables",
      "extensions",
    ]);
  });

  it("reports an answer that stops part way as no answer", async () => {
    const broken = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            pull: (controller) => {
              controller.error(new Error("reset"));
            },
          }),
        ),
    );

    expect(await run(broken)).toEqual({ ok: false });
  });

  it("gives up on an answer larger than any real one", async () => {
    const huge = answer({ data: { package: { name: "x".repeat(1_000_001) } } });

    expect(await run(huge)).toEqual({ ok: false });
  });

  it("reads an answer that arrives in pieces, even when a piece splits a character", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ data: { package: { name: "é" } } }));
    const split = bytes.indexOf(0xc3) + 1;
    const pieces = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            start: (controller) => {
              controller.enqueue(bytes.slice(0, split));
              controller.enqueue(bytes.slice(split));
              controller.close();
            },
          }),
        ),
    );

    expect(await run(pieces)).toEqual({
      ok: true,
      data: { package: { name: "é" } },
      incomplete: false,
    });
  });

  it("reports an answer with no body as no answer", async () => {
    expect(await run(vi.fn<typeof fetch>(async () => new Response(null)))).toEqual({ ok: false });
  });

  it.each([
    ["errors and no data", answer({ errors: [{ message: "PersistedQueryNotFound" }] })],
    ["null data", answer({ data: null, errors: [{ message: "failed" }] })],
    ["a failure status", answer({ data: { package: null } }, 503)],
    ["a body that isn't JSON", vi.fn<typeof fetch>(async () => new Response("<html>"))],
    ["a body of the wrong shape", answer({ data: "text" })],
    ["no answer at all", vi.fn<typeof fetch>(async () => Promise.reject(new Error("refused")))],
  ])("reports %s as no answer", async (_, fetch) => {
    expect(await run(fetch)).toEqual({ ok: false });
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

    expect(await run(hang, 10)).toEqual({ ok: false });
  });
});
