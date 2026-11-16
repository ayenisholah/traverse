import { describe, expect, it } from "vitest";
import { nameFromSegments, packagePath } from "../src/packages/package-path.ts";

const resolved = (path: string) => new URL(path, "https://traverse.example").pathname;

describe("packagePath", () => {
  it.each([
    ["express", "/packages/express"],
    ["lodash.merge", "/packages/lodash.merge"],
    ["@types/node", "/packages/%40types/node"],
  ])("[FR-WB-8] gives %s the address %s", (name, path) => {
    expect(packagePath(name)).toBe(path);
  });

  it.each(["..", "../../admin", "@x/..", ".well-known", "a/b/c", "x?y#z"])(
    "[GR-13] keeps %s, which npm couldn't have, on the packages page",
    (name) => {
      expect(packagePath(name)).toBe("/packages");
      expect(resolved(packagePath(name))).toBe("/packages");
    },
  );
});

describe("nameFromSegments", () => {
  it.each([
    [["express"], "express"],
    [["%40types", "node"], "@types/node"],
    [["@types", "node"], "@types/node"],
  ])("[FR-WB-8] reads %j as %s", (segments, name) => {
    expect(nameFromSegments(segments)).toBe(name);
  });

  it("reads a malformed address as no name", () => {
    expect(nameFromSegments(["%E0%A4%A"])).toBeUndefined();
  });
});
