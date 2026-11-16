import { describe, expect, it } from "vitest";
import { nameFromSegments, packagePath } from "../src/packages/package-path.ts";

describe("packagePath", () => {
  it.each([
    ["express", "/packages/express"],
    ["@types/node", "/packages/%40types/node"],
  ])("[FR-WB-8] gives %s the address %s", (name, path) => {
    expect(packagePath(name)).toBe(path);
  });

  it("can't be made to leave the packages pages", () => {
    expect(packagePath("../../admin?x=#y")).toBe(
      "/packages/..%2F..%2Fadmin%3Fx%3D%23y".replaceAll("%2F", "/"),
    );
  });
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
