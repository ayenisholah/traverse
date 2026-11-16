import { afterEach, expect, it, vi } from "vitest";
import { GET } from "../../src/app/api/trpc/[trpc]/route.live.ts";
import { PackageOperation } from "../../src/generated/operations.ts";
import { register } from "../../src/instrumentation.live.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const request = () =>
  new Request(
    `http://web.test/api/trpc/package?input=${encodeURIComponent(JSON.stringify({ name: "express" }))}`,
  );

it("[FR-WB-12] sends a browser's call to the configured router, once it has settings", async () => {
  vi.stubEnv("PUBLIC_ROUTER_URL", "");
  await expect(async () => GET(request())).rejects.toThrow("Set PUBLIC_ROUTER_URL");

  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(JSON.stringify({ data: { package: null } })),
  );
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("PUBLIC_ROUTER_URL", "http://router.test");

  const first = await GET(request());
  await GET(request());

  expect(await first.json()).toEqual({ result: { data: { package: null, incomplete: false } } });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]?.[0]).toBe("http://router.test/graphql");
  expect(fetch.mock.calls[0]?.[1]?.body as string).toContain(PackageOperation.sha256);
});

it("stops the server at start when a setting is missing", () => {
  vi.stubEnv("PUBLIC_ROUTER_URL", "");
  expect(register).toThrow("Set PUBLIC_ROUTER_URL");

  vi.stubEnv("PUBLIC_ROUTER_URL", "http://router.test");
  expect(register).not.toThrow();
});
