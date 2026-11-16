import { afterEach, expect, it, vi } from "vitest";
import { GET, POST } from "../../src/app/api/trpc/[trpc]/route.live.ts";
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

it("[FR-WB-12] sends each call to the router it belongs to, once the server has settings", async () => {
  vi.stubEnv("PUBLIC_ROUTER_URL", "");
  vi.stubEnv("SANDBOX_ROUTER_URL", "");
  await expect(async () => GET(request())).rejects.toThrow("Set PUBLIC_ROUTER_URL");

  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(JSON.stringify({ data: { package: null } })),
  );
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("PUBLIC_ROUTER_URL", "https://router.test");
  vi.stubEnv("SANDBOX_ROUTER_URL", "https://sandbox.test");

  const first = await GET(request());
  await GET(request());
  await POST(
    new Request("http://web.test/api/trpc/route", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "query Q { a }" }),
    }),
  );

  expect(await first.json()).toEqual({ result: { data: { package: null, incomplete: false } } });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "https://router.test/graphql",
    "https://router.test/graphql",
    "https://sandbox.test/graphql",
  ]);
  expect(fetch.mock.calls[0]?.[1]?.body as string).toContain(PackageOperation.sha256);
  expect(fetch.mock.calls[2]?.[1]?.body as string).toContain("query Q { a }");
});

it("ends the process at start when a setting is missing, and says which one", () => {
  const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  vi.stubEnv("PUBLIC_ROUTER_URL", "https://router.test");
  vi.stubEnv("SANDBOX_ROUTER_URL", "http://127.0.0.1:3004");
  register();
  expect(exit).not.toHaveBeenCalled();

  vi.stubEnv("PUBLIC_ROUTER_URL", "");
  register();
  expect(exit).toHaveBeenCalledWith(1);
  expect(write).toHaveBeenCalledWith(expect.stringContaining("Set PUBLIC_ROUTER_URL"));
});
