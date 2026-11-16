import { describe, expect, it } from "vitest";
import real from "../fixtures/manifest-subgraph-kit.json" with { type: "json" };
import { MAX_DEPENDENCIES, parseManifest } from "../../src/server/manifest.ts";

const manifest = (value: unknown) => parseManifest(JSON.stringify(value));

describe("parseManifest", () => {
  it("[FR-WB-9] reads a real project's dependencies, each at the lowest version its range allows", () => {
    expect(parseManifest(JSON.stringify(real))).toEqual({
      ok: true,
      leftOut: 0,
      entries: [
        { name: "@apollo/subgraph", range: "2.15.1", version: "2.15.1" },
        { name: "graphql", range: "^16.15.0", version: "16.15.0" },
        { name: "graphql-yoga", range: "6.0.1", version: "6.0.1" },
        { name: "ioredis", range: "6.0.0", version: "6.0.0" },
        { name: "jose", range: "6.2.15", version: "6.2.15" },
        { name: "pino", range: "10.4.0", version: "10.4.0" },
        { name: "zod", range: "^4.0.0", version: "4.0.0" },
      ],
    });
  });

  it("[FR-WB-9] reads devDependencies too, and counts a name in both once", () => {
    const parsed = manifest({
      dependencies: { ms: "^2.1.3" },
      devDependencies: { ms: "^1.0.0", vitest: "~4.1.0" },
    });

    expect(parsed).toEqual({
      ok: true,
      leftOut: 0,
      entries: [
        { name: "ms", range: "^2.1.3", version: "2.1.3" },
        { name: "vitest", range: "~4.1.0", version: "4.1.0" },
      ],
    });
  });

  it.each([
    [
      "a git URL",
      "git+https://github.com/vercel/ms.git",
      "Not a version range from the npm registry",
    ],
    ["a local folder", "file:../ms", "Not a version range from the npm registry"],
    ["a workspace", "workspace:*", "Not a version range from the npm registry"],
    ["a range no version meets", ">2.0.0 <1.0.0", "No version satisfies this range"],
    [
      "a range too long to be one",
      `^1.0.0 ${"|| 1.0.0 ".repeat(40)}`,
      "Not a version range from the npm registry",
    ],
  ])("[FR-WB-9] skips %s, and says why", (_, range, reason) => {
    const parsed = manifest({ dependencies: { ms: range } });

    expect(parsed).toMatchObject({ ok: true, entries: [{ name: "ms", skip: reason }] });
  });

  it("[GR-13] skips a range that isn't text, and a name that isn't an npm name, cutting what it shows", () => {
    const long = `../${"x".repeat(300)}`;
    const parsed = manifest({ dependencies: { ms: 2, [long]: "^1.0.0" } });

    expect(parsed).toEqual({
      ok: true,
      leftOut: 0,
      entries: [
        { name: "ms", range: "", skip: "Not a version range from the npm registry" },
        { name: long.slice(0, 214), range: "^1.0.0", skip: "Not an npm package name" },
      ],
    });
  });

  it("[FR-WB-9] checks no more than the cap, and says how many it left out", () => {
    const dependencies = Object.fromEntries(
      Array.from({ length: MAX_DEPENDENCIES + 3 }, (_, index) => [`pkg-${String(index)}`, "1.0.0"]),
    );

    const parsed = manifest({ dependencies });

    expect(parsed).toMatchObject({ ok: true, leftOut: 3 });
    expect(parsed.ok && parsed.entries).toHaveLength(MAX_DEPENDENCIES);
  });

  it.each([
    ["text that isn't JSON", "{ not json"],
    ["a JSON list", "[1, 2]"],
    ["JSON text", '"package.json"'],
    ["dependencies that aren't an object", '{ "dependencies": ["ms"] }'],
  ])("[GR-13] refuses %s", (_, text) => {
    expect(parseManifest(text)).toEqual({
      ok: false,
      message: "This isn't a package.json: it must be a JSON object.",
    });
  });

  it("says so when there's nothing to check", () => {
    expect(manifest({ name: "empty", scripts: { test: "rm -rf /" } })).toEqual({
      ok: false,
      message: "This package.json lists no dependencies.",
    });
  });
});
