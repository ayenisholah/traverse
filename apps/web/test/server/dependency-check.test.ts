import { describe, expect, it, vi } from "vitest";
import lodash from "../fixtures/router-dep-lodash.json" with { type: "json" };
import zod from "../fixtures/router-dep-zod.json" with { type: "json" };
import { DependencyOperation } from "../../src/generated/operations.ts";
import { checkDependencies } from "../../src/server/dependency-check.ts";
import type { RouterClient, RouterResult } from "../../src/server/router-client.ts";

const routerOf = (answer: (name: string) => RouterResult) => {
  const run = vi.fn(async (_operation: unknown, { name }: { name: string }) => answer(name));
  return { router: { run } as unknown as RouterClient, run };
};

describe("checkDependencies", () => {
  it("[FR-WB-9] checks each dependency at its version through the Dependency operation", async () => {
    const answers: Record<string, unknown> = { lodash: lodash.data, zod: zod.data };
    const { router, run } = routerOf((name) => ({
      ok: true,
      data: answers[name],
      incomplete: false,
    }));

    const answer = await checkDependencies(
      router,
      [
        { name: "lodash", range: "4.17.20", version: "4.17.20" },
        { name: "zod", range: "^4.0.0", version: "4.0.0" },
      ],
      2,
    );

    expect(run).toHaveBeenCalledWith(DependencyOperation, { name: "lodash", version: "4.17.20" });
    expect(answer).toEqual({
      kind: "checked",
      leftOut: 2,
      dependencies: [
        {
          name: "lodash",
          range: "4.17.20",
          version: "4.17.20",
          status: "checked",
          latestVersion: lodash.data.package.latestVersion,
          license: "MIT",
          advisories: lodash.data.package.advisories,
        },
        expect.objectContaining({
          name: "zod",
          status: "checked",
          advisories: zod.data.package.advisories,
        }),
      ],
    });
  });

  it("[FR-WB-9] keeps the manifest's order, whatever order the answers arrive in", async () => {
    const run = vi.fn(async (_operation: unknown, { name }: { name: string }) => {
      await new Promise((done) => setTimeout(done, name === "a" ? 30 : 0));
      return { ok: true as const, data: { package: null }, incomplete: false };
    });

    const answer = await checkDependencies(
      { run } as unknown as RouterClient,
      ["a", "b", "c"].map((name) => ({ name, range: "1.0.0", version: "1.0.0" })),
      0,
    );

    expect(answer.kind === "checked" && answer.dependencies.map(({ name }) => name)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("[FR-WB-9] asks the router about no more than four at once", async () => {
    let running = 0;
    let most = 0;
    const run = vi.fn(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((done) => setTimeout(done, 5));
      running -= 1;
      return { ok: true as const, data: { package: null }, incomplete: false };
    });

    await checkDependencies(
      { run },
      Array.from({ length: 10 }, (_, index) => ({
        name: `p${String(index)}`,
        range: "1.0.0",
        version: "1.0.0",
      })),
      0,
    );

    expect(run).toHaveBeenCalledTimes(10);
    expect(most).toBe(4);
  });

  it("[FR-SG-6] never reads an incomplete answer as no advisories", async () => {
    const data = { package: { ...zod.data.package, advisories: null } };
    const { router } = routerOf(() => ({ ok: true, data, incomplete: true }));

    const answer = await checkDependencies(
      router,
      [{ name: "zod", range: "^4.0.0", version: "4.0.0" }],
      0,
    );

    expect(answer).toMatchObject({
      dependencies: [{ status: "checked", advisories: null, license: "MIT" }],
    });
  });

  it("[FR-SG-6] reports a dependency npm couldn't answer for as not checked, never as missing", async () => {
    const { router } = routerOf(() => ({ ok: true, data: { package: null }, incomplete: true }));

    const answer = await checkDependencies(
      router,
      [{ name: "express", range: "^4.0.0", version: "4.0.0" }],
      0,
    );

    expect(answer).toMatchObject({ dependencies: [{ name: "express", status: "unavailable" }] });
  });

  it("[FR-WB-9] stops asking once the deadline passes, and reports the rest as not checked", async () => {
    let clock = 0;
    const run = vi.fn(async () => {
      clock += 20_000;
      return { ok: true as const, data: { package: null }, incomplete: false };
    });
    const entries = [
      ...["a", "b", "c", "d", "e", "f"].map((name) => ({ name, range: "1.0.0", version: "1.0.0" })),
      { name: "g", range: "file:x", skip: "Not npm" },
    ];

    const answer = await checkDependencies({ run }, entries, 0, {
      deadlineMs: 30_000,
      now: () => clock,
    });

    // Each call moves the clock on 20 s as it starts, so two start before the 30 s deadline.
    expect(answer.kind === "checked" && answer.dependencies.map(({ status }) => status)).toEqual([
      "not-found",
      "not-found",
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
      "skipped",
    ]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("[FR-WB-9] asks nothing more once the browser has gone", async () => {
    const controller = new AbortController();
    const run = vi.fn(async () => {
      controller.abort();
      return { ok: true as const, data: { package: null }, incomplete: false };
    });
    const entries = Array.from({ length: 8 }, (_, index) => ({
      name: `p${String(index)}`,
      range: "1.0.0",
      version: "1.0.0",
    }));

    const answer = await checkDependencies({ run }, entries, 0, { signal: controller.signal });

    // The first call ends the request as it starts, so no other is made.
    expect(run).toHaveBeenCalledTimes(1);
    expect(
      answer.kind === "checked" && answer.dependencies.slice(1).map(({ status }) => status),
    ).toEqual(Array<string>(7).fill("unavailable"));
  });

  it.each([
    [
      "the package doesn't exist",
      { ok: true, data: { package: null }, incomplete: false },
      "not-found",
    ],
    ["the router doesn't answer", { ok: false }, "unavailable"],
    [
      "the router sends a field nobody asked for",
      {
        ok: true,
        data: { package: { ...zod.data.package, maintainers: ["a@b.example"] } },
        incomplete: false,
      },
      "unavailable",
    ],
  ] as const)("[GR-16] reports a dependency as %s", async (_, result, status) => {
    const { router } = routerOf(() => result);

    const answer = await checkDependencies(
      router,
      [{ name: "zod", range: "^4.0.0", version: "4.0.0" }],
      0,
    );

    expect(answer).toEqual({
      kind: "checked",
      leftOut: 0,
      dependencies: [{ name: "zod", range: "^4.0.0", version: "4.0.0", status }],
    });
  });

  it("[FR-WB-9] passes a skipped dependency through without asking the router", async () => {
    const { router, run } = routerOf(() => ({ ok: false }));

    const answer = await checkDependencies(
      router,
      [{ name: "ms", range: "file:../ms", skip: "Not npm" }],
      0,
    );

    expect(run).not.toHaveBeenCalled();
    expect(answer).toEqual({
      kind: "checked",
      leftOut: 0,
      dependencies: [{ name: "ms", range: "file:../ms", status: "skipped", reason: "Not npm" }],
    });
  });
});
