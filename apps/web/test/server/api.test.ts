import { describe, expect, it, vi } from "vitest";
import { PackageOperation } from "../../src/generated/operations.ts";
import { handleApiRequest } from "../../src/server/api.ts";
import type { RouterClient, RouterResult } from "../../src/server/router-client.ts";

const routerThat = (result: RouterResult | Error) => {
  const run = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { router: { run } as unknown as RouterClient, run };
};

const call = async (input: unknown, router: RouterClient, path = "package") => {
  const url = `http://web.test/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await handleApiRequest(new Request(url), router);
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

    await handleApiRequest(request, router);

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

    const response = await handleApiRequest(new Request(url), router);

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
    const response = await handleApiRequest(
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

    const response = await handleApiRequest(new Request(url), router);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(run).not.toHaveBeenCalled();
  });
});
