import { describe, expect, it, vi } from "vitest";
import { PackageOperation } from "../../src/generated/operations.ts";
import { handleApiRequest } from "../../src/server/api.ts";
import type { RouterClient, RouterResult } from "../../src/server/router-client.ts";

const routerThat = (result: RouterResult<unknown> | Error) => {
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

const express = { name: "express", latestVersion: "5.3.0" };

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

    const { status } = await call(input, router);

    expect(status).toBe(400);
    expect(run).not.toHaveBeenCalled();
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

  it("has no procedure it wasn't given", async () => {
    const { router } = routerThat({ ok: false });

    expect((await call({}, router, "secrets")).status).toBe(404);
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
