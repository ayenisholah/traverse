import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "../fixtures/router-package-express.json" with { type: "json" };
import { PackageOperation } from "../../src/generated/operations.ts";
import {
  freePort,
  startStubRouter,
  startWebServer,
  waitUntilReady,
  type StubRouter,
  type WebServer,
} from "../support/live-server.ts";

const app = join(import.meta.dirname, "../..");
const input = (value: unknown) => encodeURIComponent(JSON.stringify(value));

describe("the server build", () => {
  let router: StubRouter;
  let server: WebServer;

  beforeAll(async () => {
    router = await startStubRouter(PackageOperation.sha256);
    server = startWebServer(await freePort(), { PUBLIC_ROUTER_URL: router.url });
    await waitUntilReady(server);
  }, 60_000);

  afterAll(async () => {
    await server.stop();
    router.stop();
  });

  it("[FR-WB-12] answers a browser's call with the router's data, having sent the generated hash", async () => {
    const response = await fetch(
      `${server.url}/api/trpc/package?input=${input({ name: "express" })}`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: { data: { package: express.data.package, incomplete: false } },
    });
    expect(router.requests.at(-1)).toEqual({
      variables: { name: "express", version: null },
      extensions: { persistedQuery: { version: 1, sha256Hash: PackageOperation.sha256 } },
    });
  });

  it("refuses a bad package name without calling the router", async () => {
    const before = router.requests.length;
    const response = await fetch(`${server.url}/api/trpc/package?input=${input({ name: "../x" })}`);

    expect(response.status).toBe(400);
    expect(router.requests).toHaveLength(before);
  });

  it("serves the map and the impact check, as the static export does", async () => {
    const home = await fetch(server.url);
    const impact = await fetch(`${server.url}/impact`);

    expect(await home.text()).toContain('id="type-option-Employee"');
    expect(await impact.text()).toContain('id="draft"');
  });

  it("[GR-9] sends the router's address to no page", async () => {
    const address = new URL(router.url).host;
    const pages = await Promise.all(
      ["/", "/impact", "/?_rsc=1"].map(async (path) =>
        (await fetch(`${server.url}${path}`, { headers: { rsc: "1" } })).text(),
      ),
    );

    expect(pages.join("")).not.toContain(address);
  });

  it("doesn't name its framework in a header", async () => {
    expect((await fetch(server.url)).headers.get("x-powered-by")).toBeNull();
  });
});

describe("starting the server build", () => {
  it("ends at once when the router's address is missing, and says what to set", async () => {
    const server = startWebServer(await freePort(), {});

    expect(await server.exited).toBe(1);
    expect(server.output()).toContain("Set PUBLIC_ROUTER_URL to the public router's origin");
  }, 30_000);
});

const filesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));

// Names that exist only in server code. Any of them in a file the browser downloads means server
// code, or a server setting, was bundled for the browser.
const SERVER_ONLY = ["PUBLIC_ROUTER_URL", "persistedQuery", "sha256Hash", PackageOperation.sha256];

describe("what the browser downloads", () => {
  it.each([
    ["the server build", join(app, ".next-server/static")],
    ["the static export", join(app, "out")],
  ])("[GR-9] holds no server setting and no server code, in %s", (_, directory) => {
    const files = filesUnder(directory);
    const leaks = files.flatMap((file) => {
      const content = readFileSync(file, "utf8");
      return SERVER_ONLY.filter((name) => content.includes(name)).map((name) => `${file}: ${name}`);
    });

    expect(files.some((file) => file.endsWith(".js"))).toBe(true);
    expect(leaks).toEqual([]);
  });
});
