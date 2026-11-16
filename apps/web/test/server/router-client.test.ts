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
