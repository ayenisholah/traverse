import { describe, expect, it } from "vitest";
import { diffLines } from "../src/assistant/line-diff.ts";

describe("diffLines", () => {
  it("[FR-AI-2] marks the lines a suggestion adds, removes and keeps", () => {
    expect(diffLines("type A {\n  a: Int\n  b: Int\n}", "type A {\n  a: Int\n  c: Int\n}")).toEqual(
      [
        { kind: "same", text: "type A {" },
        { kind: "same", text: "  a: Int" },
        { kind: "added", text: "  c: Int" },
        { kind: "removed", text: "  b: Int" },
        { kind: "same", text: "}" },
      ],
    );
  });

  it("[FR-AI-2] handles an empty side and identical texts", () => {
    expect(diffLines("", "a")).toEqual([
      { kind: "added", text: "a" },
      { kind: "removed", text: "" },
    ]);
    expect(diffLines("a\nb", "a")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
    ]);
    expect(diffLines("a", "a").every(({ kind }) => kind === "same")).toBe(true);
  });
});
