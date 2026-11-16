import { describe, expect, it } from "vitest";
import { summarise } from "../src/packages/summary.ts";
import type { DependencyResult } from "../src/packages/types.ts";

const checked = (name: string, advisories: number | null): DependencyResult => ({
  name,
  range: "1.0.0",
  version: "1.0.0",
  status: "checked",
  latestVersion: "1.0.0",
  license: "MIT",
  advisories:
    advisories === null
      ? null
      : Array.from({ length: advisories }, (_, index) => ({
          id: `GHSA-${String(index)}`,
          summary: "s",
          severity: null,
          fixedIn: null,
        })),
});
const unavailable: DependencyResult = {
  name: "u",
  range: "1.0.0",
  version: "1.0.0",
  status: "unavailable",
};
const skipped: DependencyResult = { name: "s", range: "file:x", status: "skipped", reason: "r" };
const missing: DependencyResult = {
  name: "m",
  range: "1.0.0",
  version: "1.0.0",
  status: "not-found",
};

describe("summarise", () => {
  it("[FR-WB-9] says how many were checked and how many have advisories", () => {
    expect(summarise([checked("a", 2), checked("b", 0)], 0)).toBe(
      "2 dependencies listed. 2 checked: 1 has advisories for the version checked.",
    );
    expect(summarise([checked("a", 1), checked("b", 3)], 0)).toBe(
      "2 dependencies listed. 2 checked: 2 have advisories for the version checked.",
    );
  });

  it("[FR-WB-9] says none has an advisory only about the ones it read", () => {
    expect(summarise([checked("a", 0)], 0)).toBe(
      "1 dependency listed. 1 checked: none has an advisory for the version checked.",
    );
  });

  it("[FR-SG-6] never sounds clean when nothing could be read", () => {
    const summary = summarise([unavailable, checked("b", null)], 0);

    expect(summary).toBe(
      "2 dependencies listed. None could be checked for advisories. 2 couldn't be read just now, so they may have advisories.",
    );
    expect(summary).not.toMatch(/none has an advisory/i);
  });

  it("[FR-SG-6] names a single unread dependency, beside the ones it did read", () => {
    expect(summarise([checked("a", 0), unavailable], 0)).toBe(
      "2 dependencies listed. 1 checked: none has an advisory for the version checked. 1 couldn't be read just now, so it may have advisories.",
    );
  });

  it("counts the skipped, the missing and the left out", () => {
    expect(summarise([skipped, missing], 7)).toBe(
      "2 dependencies listed. None could be checked for advisories. 1 skipped. 1 not found on npm. 7 more left out: the check covers the first 100.",
    );
  });
});
