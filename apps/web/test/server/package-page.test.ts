import { describe, expect, it, vi } from "vitest";
import express from "../fixtures/router-page-express.json" with { type: "json" };
import { PackagePageOperation } from "../../src/generated/operations.ts";
import { loadPackagePage } from "../../src/server/package-page.ts";
import type { RouterResult } from "../../src/server/router-client.ts";

const load = async (result: RouterResult) => {
  const run = vi.fn(async () => result);
  const answer = await loadPackagePage({ run }, "express");
  return { run, answer };
};

const page = express.data.package;

describe("loadPackagePage", () => {
  it("[FR-WB-8] reads the router's answer for a real package into the page", async () => {
    const { run, answer } = await load({ ok: true, data: express.data, incomplete: false });

    expect(run).toHaveBeenCalledWith(PackagePageOperation, { name: "express" });
    expect(answer).toEqual({
      kind: "found",
      incomplete: false,
      package: {
        name: "express",
        latestVersion: page.latestVersion,
        license: page.license,
        weeklyDownloads: page.weeklyDownloads,
        recentVersions: expect.any(Array) as unknown,
        versionCount: page.versions.length,
        dependencies: page.dependencies,
        repository: page.repository,
        advisories: page.advisories,
      },
    });
  });

  it("[FR-WB-8] lists the newest twenty versions, newest first by semver, not by text", async () => {
    const data = {
      package: { ...page, versions: ["1.0.0", "10.0.0", "2.0.0", "2.0.0-rc.1", "not-a-version"] },
    };
    const { answer } = await load({ ok: true, data, incomplete: false });

    expect(answer).toMatchObject({
      package: { recentVersions: ["10.0.0", "2.0.0", "2.0.0-rc.1", "1.0.0"], versionCount: 4 },
    });
    const real = await load({ ok: true, data: express.data, incomplete: false });
    expect(real.answer.kind === "found" && real.answer.package.recentVersions).toHaveLength(20);
    expect(real.answer.kind === "found" && real.answer.package.recentVersions[0]).toBe(
      page.latestVersion,
    );
  });

  it("says nothing about versions it couldn't read", async () => {
    const data = { package: { ...page, versions: null } };
    const { answer } = await load({ ok: true, data, incomplete: true });

    expect(answer).toMatchObject({
      incomplete: true,
      package: { recentVersions: [], versionCount: null },
    });
  });

  it("[FR-SG-6] reports a package npm couldn't answer for as unavailable, never as missing", async () => {
    const { answer } = await load({ ok: true, data: { package: null }, incomplete: true });

    expect(answer).toEqual({ kind: "unavailable" });
  });

  it.each([
    [
      "a package that doesn't exist",
      { ok: true, data: { package: null }, incomplete: false },
      "not-found",
    ],
    ["no answer", { ok: false }, "unavailable"],
    [
      "a field nobody asked for",
      {
        ok: true,
        data: { package: { ...page, maintainers: [{ email: "a@b.example" }] } },
        incomplete: false,
      },
      "unavailable",
    ],
  ] as const)("[GR-16] reports %s", async (_, result, kind) => {
    const { answer } = await load(result);

    expect(answer).toEqual({ kind });
  });
});
