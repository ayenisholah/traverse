import { describe, expect, it, vi } from "vitest";
import { PackageOperation } from "../../src/generated/operations.ts";
import { handleApiRequest as handle, type Context } from "../../src/server/api.ts";
import type { RouteAnswer } from "../../src/route/types.ts";
import type { RouterResult } from "../../src/server/router-client.ts";

const unused = { route: vi.fn(async (): Promise<RouteAnswer> => ({ kind: "unavailable" })) };

const routerThat = (result: RouterResult | Error) => {
  const run = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { router: { router: { run }, sandbox: unused } as unknown as Context, run };
};

const call = async (input: unknown, router: Context, path = "package") => {
  const url = `http://web.test/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await handle(new Request(url), router);
  return { status: response.status, body: (await response.json()) as unknown };
};

const express = {
  name: "express",
  latestVersion: "5.3.0",
  license: "MIT",
  weeklyDownloads: 1,
  repositoryUrl: null,
  repository: null,
  advisories: [{ id: "GHSA-1", summary: "A summary", severity: null, fixedIn: "5.0.0" }],
};

describe("the package procedure", () => {
  it("[FR-WB-12] runs the generated Package operation with the caller's variables", async () => {
    const { router, run } = routerThat({ ok: true, data: { package: express }, incomplete: false });

    const { status, body } = await call({ name: "express", version: "5.3.0" }, router);

    expect(run).toHaveBeenCalledWith(PackageOperation, { name: "express", version: "5.3.0" });
    expect(status).toBe(200);
    expect(body).toEqual({ result: { data: { package: express, incomplete: false } } });
  });

  it("asks for the latest version when none is given, and passes on an incomplete answer", async () => {
    const { router, run } = routerThat({ ok: true, data: { package: express }, incomplete: true });

    const { body } = await call({ name: "@scope/pkg" }, router);

    expect(run).toHaveBeenCalledWith(PackageOperation, { name: "@scope/pkg", version: null });
    expect(body).toMatchObject({ result: { data: { incomplete: true } } });
  });

  it.each([
    ["a name that isn't an npm name", { name: "../etc/passwd" }],
    ["a name that's too long", { name: "a".repeat(215) }],
    ["a version that isn't a version", { name: "express", version: "latest; drop" }],
    ["no name", {}],
  ])("refuses %s before the router is called", async (_, input) => {
    const { router, run } = routerThat({ ok: true, data: { package: null }, incomplete: false });

    const { status, body } = await call(input, router);

    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { message: "Invalid input" } });
    expect(JSON.stringify(body)).not.toMatch(/passwd|drop/);
    expect(run).not.toHaveBeenCalled();
  });

  it("[GR-2] passes on only the name and version, whatever else the caller sends", async () => {
    const { router, run } = routerThat({ ok: true, data: { package: null }, incomplete: false });
    const input = {
      name: "ms",
      sha256: "0".repeat(64),
      url: "http://evil.example",
      extensions: {},
    };
    const url = `http://web.test/api/trpc/package?input=${encodeURIComponent(JSON.stringify(input))}`;
    const request = new Request(url, {
      headers: { cookie: "session=1", authorization: "Bearer x" },
    });

    await handle(request, router);

    expect(run).toHaveBeenCalledWith(PackageOperation, { name: "ms", version: null });
  });

  it.each([
    [
      "a field the operation never asked for",
      { package: { ...express, maintainers: ["a@b.example"] } },
    ],
    ["a second root field", { package: express, viewer: { email: "a@b.example" } }],
    ["a field of the wrong type", { package: { ...express, weeklyDownloads: "many" } }],
    ["no package field at all", {}],
  ])("[GR-16] answers 503, and sends none of it, when the router returns %s", async (_, data) => {
    const { router } = routerThat({ ok: true, data, incomplete: false });

    const { status, body } = await call({ name: "express" }, router);

    expect(status).toBe(503);
    expect(JSON.stringify(body)).not.toMatch(/example|express|many/);
  });

  it("marks its answers as live data that is only ever JSON", async () => {
    const { router } = routerThat({ ok: true, data: { package: null }, incomplete: false });
    const url = `http://web.test/api/trpc/package?input=${encodeURIComponent('{"name":"ms"}')}`;

    const response = await handle(new Request(url), router);

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers 503 when the graph doesn't answer", async () => {
    const { router } = routerThat({ ok: false });

    const { status, body } = await call({ name: "express" }, router);

    expect(status).toBe(503);
    expect(body).toEqual({
      error: {
        code: expect.any(Number) as number,
        message: "The graph didn't answer",
        data: { code: "SERVICE_UNAVAILABLE", httpStatus: 503 },
      },
    });
  });

  it("keeps an unexpected fault's message and stack on the server", async () => {
    const { router } = routerThat(new Error("connect ECONNREFUSED 10.0.0.7:3002"));

    const { status, body } = await call({ name: "express" }, router);

    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.7|stack|api\.ts/);
    expect(body).toMatchObject({ error: { message: "Something went wrong" } });
  });

  it("has no procedure it wasn't given, and doesn't repeat the path asked for", async () => {
    const { router } = routerThat({ ok: false });

    const { status, body } = await call({}, router, "<img src=x onerror=alert(1)>");

    expect(status).toBe(404);
    expect(body).toMatchObject({ error: { message: "Not found" } });
    expect(JSON.stringify(body)).not.toContain("onerror");
  });

  it("doesn't repeat input it can't parse", async () => {
    const { router } = routerThat({ ok: false });
    const response = await handle(
      new Request("http://web.test/api/trpc/package?input=%7Bplanted-text"),
      router,
    );

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("planted");
  });

  it("refuses several calls in one request, so one request is one router call", async () => {
    const { router, run } = routerThat({ ok: true, data: { package: null }, incomplete: false });
    const input = encodeURIComponent(JSON.stringify({ 0: { name: "a" }, 1: { name: "b" } }));
    const url = `http://web.test/api/trpc/package,package?batch=1&input=${input}`;

    const response = await handle(new Request(url), router);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(run).not.toHaveBeenCalled();
  });
});

const ROUTE: RouteAnswer = {
  kind: "route",
  route: {
    steps: [
      {
        id: 0,
        subgraph: "packages",
        kind: "root",
        path: null,
        after: [],
        stage: 0,
        query: "{ q }",
      },
    ],
  },
};

const sandboxThat = (answer: RouteAnswer) => {
  const route = vi.fn(async () => answer);
  const context = { router: { run: vi.fn() }, sandbox: { route } } as unknown as Context;
  return { context, route };
};

const askRoute = async (input: unknown, context: Context, method = "POST") => {
  const request =
    method === "POST"
      ? new Request("http://web.test/api/trpc/route", {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        })
      : new Request(
          `http://web.test/api/trpc/route?input=${encodeURIComponent(JSON.stringify(input))}`,
        );
  const response = await handle(request, context);
  return { status: response.status, body: (await response.json()) as unknown };
};

describe("the route procedure", () => {
  it("[GR-11] refuses a body larger than any real call, before reading it whole or calling the sandbox", async () => {
    const { context, route } = sandboxThat(ROUTE);
    const operation = "x".repeat(600_000);

    const { status, body } = await askRoute({ operation }, context);

    expect(status).toBe(413);
    expect(body).toMatchObject({ error: { message: "Request too large" } });
    expect(route).not.toHaveBeenCalled();
  });

  it("reads a body just under the cap", async () => {
    const { context, route } = sandboxThat(ROUTE);

    const { status } = await askRoute(
      { operation: "{ a }", variables: { pad: "x".repeat(9_000) } },
      context,
    );

    expect(status).toBe(200);
    expect(route).toHaveBeenCalled();
  });

  it("[FR-WB-7] sends the operation and variables to the sandbox, and returns its answer", async () => {
    const { context, route } = sandboxThat(ROUTE);

    const { status, body } = await askRoute(
      { operation: "query Q { a }", variables: { name: "express" } },
      context,
    );

    expect(route).toHaveBeenCalledWith("query Q { a }", { name: "express" });
    expect(status).toBe(200);
    expect(body).toEqual({ result: { data: ROUTE } });
  });

  it("sends no variables when none are given", async () => {
    const { context, route } = sandboxThat({ kind: "refused", messages: ["no"] });

    const { body } = await askRoute({ operation: "{ a }" }, context);

    expect(route).toHaveBeenCalledWith("{ a }", {});
    expect(body).toEqual({ result: { data: { kind: "refused", messages: ["no"] } } });
  });

  it("[GR-4] takes the operation in a POST body only, never in an address", async () => {
    const { context, route } = sandboxThat(ROUTE);

    const { status } = await askRoute({ operation: "query Q { a }" }, context, "GET");

    expect(status).toBe(405);
    expect(route).not.toHaveBeenCalled();
  });

  it.each([
    ["no operation", {}],
    ["an empty operation", { operation: "" }],
    ["an operation too long to be one", { operation: "x".repeat(10_001) }],
    ["variables that aren't an object", { operation: "{ a }", variables: "name" }],
    ["variables too large", { operation: "{ a }", variables: { name: "x".repeat(10_000) } }],
  ])("refuses %s before the sandbox is called", async (_, input) => {
    const { context, route } = sandboxThat(ROUTE);

    expect((await askRoute(input, context)).status).toBe(400);
    expect(route).not.toHaveBeenCalled();
  });
});

const routerFor = (result: RouterResult) => {
  const run = vi.fn(async () => result);
  return { context: { router: { run }, sandbox: unused } as unknown as Context, run };
};

describe("the package page procedure", () => {
  it("[FR-WB-8] answers with the page for a valid name", async () => {
    const { context } = routerFor({ ok: true, data: { package: null }, incomplete: false });

    const { status, body } = await call({ name: "@types/ms" }, context, "packagePage");

    expect(status).toBe(200);
    expect(body).toEqual({ result: { data: { kind: "not-found" } } });
  });

  it("refuses a name that isn't an npm name before the router is called", async () => {
    const { context, run } = routerFor({ ok: false });

    expect((await call({ name: "../x" }, context, "packagePage")).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});

const checkManifest = async (input: unknown, context: Context) => {
  const response = await handle(
    new Request("http://web.test/api/trpc/checkManifest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
    context,
  );
  return { status: response.status, body: (await response.json()) as unknown };
};

describe("the package.json check procedure", () => {
  it("[FR-WB-9] checks each dependency of a pasted package.json", async () => {
    const { context, run } = routerFor({ ok: true, data: { package: null }, incomplete: false });

    const { status, body } = await checkManifest(
      { manifest: JSON.stringify({ dependencies: { ms: "^2.1.3" } }) },
      context,
    );

    expect(status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    expect(body).toEqual({
      result: {
        data: {
          kind: "checked",
          leftOut: 0,
          dependencies: [{ name: "ms", range: "^2.1.3", version: "2.1.3", status: "not-found" }],
        },
      },
    });
  });

  it("[FR-WB-9] stops the check when the browser's request is already gone", async () => {
    const controller = new AbortController();
    controller.abort();
    const { context, run } = routerFor({ ok: true, data: { package: null }, incomplete: false });

    await handle(
      new Request("http://web.test/api/trpc/checkManifest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: JSON.stringify({ dependencies: { ms: "^2.1.3" } }) }),
        signal: controller.signal,
      }),
      context,
    ).catch(() => undefined);

    expect(run).not.toHaveBeenCalled();
  });

  it("[GR-13] says why it can't read the paste, and asks the router nothing", async () => {
    const { context, run } = routerFor({ ok: false });

    const { body } = await checkManifest({ manifest: "{ nope" }, context);

    expect(body).toEqual({
      result: {
        data: { kind: "invalid", message: "This isn't a package.json: it must be a JSON object." },
      },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ["nothing", { manifest: "" }],
    ["a paste too long to be a package.json", { manifest: "x".repeat(30_001) }],
  ])("refuses %s", async (_, input) => {
    const { context, run } = routerFor({ ok: false });

    expect((await checkManifest(input, context)).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("[GR-4] takes the paste in a POST body only, never in an address", async () => {
    const { context, run } = routerFor({ ok: false });
    const input = encodeURIComponent(JSON.stringify({ manifest: "{}" }));

    const response = await handle(
      new Request(`http://web.test/api/trpc/checkManifest?input=${input}`),
      context,
    );

    expect(response.status).toBe(405);
    expect(run).not.toHaveBeenCalled();
  });
});
