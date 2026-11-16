import { describe, expect, it, vi } from "vitest";
import { createFetchRoute } from "../src/operations/route-client.ts";
import type { RouteAnswer } from "../src/route/types.ts";

const ROUTE: RouteAnswer = { kind: "route", route: { steps: [] } };

describe("createFetchRoute", () => {
  it("[FR-WB-7] posts the operation to this app's own server and returns its answer", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ result: { data: ROUTE } }), {
          headers: { "content-type": "application/json" },
        }),
    );

    const answer = await createFetchRoute(fetch)("query Q { a }", { name: "express" });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(answer).toEqual(ROUTE);
    expect(url).toBe("/api/trpc/route");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      operation: "query Q { a }",
      variables: { name: "express" },
    });
  });

  it.each([
    ["the server refuses the call", async () => new Response("{}", { status: 500 })],
    ["the network fails", async () => Promise.reject(new Error("offline"))],
  ])("reports the route as unavailable when %s", async (_, respond) => {
    const fetch = vi.fn<typeof globalThis.fetch>(respond);

    expect(await createFetchRoute(fetch)("{ a }", {})).toEqual({ kind: "unavailable" });
  });

  it("uses the browser's own fetch when none is given", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify({ result: { data: ROUTE } })),
    );
    vi.stubGlobal("fetch", fetch);

    expect(await createFetchRoute()("{ a }", {})).toEqual(ROUTE);
    vi.unstubAllGlobals();
  });
});
