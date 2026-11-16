import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "../fixtures/router-package-express.json" with { type: "json" };
import { PackageOperation } from "../../src/generated/operations.ts";
import {
  freePort,
  startStubRouter,
  startStubSandbox,
  startWebServer,
  waitUntilReady,
  type StubRouter,
  type StubSandbox,
  type WebServer,
} from "../support/live-server.ts";

const app = join(import.meta.dirname, "../..");
const input = (value: unknown) => encodeURIComponent(JSON.stringify(value));

describe("the server build", () => {
  let router: StubRouter;
  let sandbox: StubSandbox;
  let server: WebServer;

  beforeAll(async () => {
    router = await startStubRouter(PackageOperation.sha256);
    sandbox = await startStubSandbox();
    server = startWebServer(await freePort(), {
      PUBLIC_ROUTER_URL: router.url,
      SANDBOX_ROUTER_URL: sandbox.url,
    });
    await waitUntilReady(server);
  }, 60_000);

  afterAll(async () => {
    await server.stop();
    router.stop();
    sandbox.stop();
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

  it("[FR-WB-7] answers with an operation's route, having sent the operation to the sandbox router only", async () => {
    const before = router.requests.length;
    const response = await fetch(`${server.url}/api/trpc/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: 'query Q { package(name: "express") { name } }' }),
    });
    const body = (await response.json()) as {
      result: { data: { kind: string; route: { steps: { subgraph: string; stage: number }[] } } };
    };

    expect(body.result.data.kind).toBe("route");
    expect(body.result.data.route.steps.map(({ subgraph, stage }) => [subgraph, stage])).toEqual([
      ["packages", 0],
      ["repositories", 1],
      ["advisories", 1],
    ]);
    expect(sandbox.operations.at(-1)).toContain("query Q");
    expect(router.requests).toHaveLength(before);
    // The stub's answer holds express's data, and none of it may come back with the route.
    expect(JSON.stringify(body)).not.toMatch(/GHSA|expressjs/);
  });

  it("[FR-WB-7] serves the operations page, with the editor's starting operation", async () => {
    const page = await (await fetch(`${server.url}/operations`)).text();

    expect(page).toContain("<title>Operations · Traverse</title>");
    expect(page).toContain('href="/operations"');
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
    const addresses = [router.url, sandbox.url].map((url) => new URL(url).host);
    const pages = await Promise.all(
      ["/", "/impact", "/operations", "/?_rsc=1", "/operations?_rsc=1"].map(async (path) =>
        (await fetch(`${server.url}${path}`, { headers: { rsc: "1" } })).text(),
      ),
    );

    for (const address of addresses) expect(pages.join("")).not.toContain(address);
  });

  it("doesn't name its framework in a header", async () => {
    expect((await fetch(server.url)).headers.get("x-powered-by")).toBeNull();
  });
});

describe("starting the server build", () => {
  it.each([
    ["both routers' addresses", {}],
    ["the sandbox router's address", { PUBLIC_ROUTER_URL: "http://127.0.0.1:3002" }],
  ])(
    "ends at once when %s is missing, and says what to set",
    async (_, env) => {
      const server = startWebServer(await freePort(), env);

      expect(await server.exited).toBe(1);
      expect(server.output()).toContain("Set PUBLIC_ROUTER_URL and SANDBOX_ROUTER_URL");
    },
    30_000,
  );
});

const filesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));

// Names that exist only in server code. Any of them in a file the browser downloads means server
// code, or a server setting, was bundled for the browser.
const SERVER_ONLY = [
  "PUBLIC_ROUTER_URL",
  "SANDBOX_ROUTER_URL",
  "persistedQuery",
  "sha256Hash",
  "queryPlan",
  PackageOperation.sha256,
];

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
