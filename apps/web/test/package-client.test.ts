import { describe, expect, it, vi } from "vitest";
import { createCheckManifest, createLoadPackage } from "../src/packages/package-client.ts";

const answering = (data: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ result: { data } })));
const failing = vi.fn<typeof fetch>(async () => Promise.reject(new Error("offline")));

describe("createLoadPackage", () => {
  it("[FR-WB-8] asks this app's server for a package's page", async () => {
    const fetch = answering({ kind: "not-found" });

    expect(await createLoadPackage(fetch)("@types/ms")).toEqual({ kind: "not-found" });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `/api/trpc/packagePage?input=${encodeURIComponent(JSON.stringify({ name: "@types/ms" }))}`,
    );
  });

  it("reports the page as unavailable when the server can't be reached", async () => {
    expect(await createLoadPackage(failing)("ms")).toEqual({ kind: "unavailable" });
  });
});

describe("createCheckManifest", () => {
  it("[GR-4] posts the pasted text in the body, never in the address", async () => {
    const fetch = answering({ kind: "invalid", message: "no" });

    expect(await createCheckManifest(fetch)('{ "dependencies": {} }')).toEqual({
      kind: "invalid",
      message: "no",
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/trpc/checkManifest");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ manifest: '{ "dependencies": {} }' });
  });

  it("reports the check as unavailable when the server can't be reached", async () => {
    expect(await createCheckManifest(failing)("{}")).toEqual({ kind: "unavailable" });
  });

  it("uses the browser's own fetch when none is given", async () => {
    vi.stubGlobal("fetch", answering({ kind: "not-found" }));

    expect(await createLoadPackage()("ms")).toEqual({ kind: "not-found" });
    vi.unstubAllGlobals();
  });
});
