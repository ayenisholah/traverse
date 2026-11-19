import { describe, expect, it, vi } from "vitest";
import type { Assistant } from "../../../src/server/assistant/assistant.ts";
import { suggest } from "../../../src/server/assistant/suggest.ts";

// Composition throws on any proposed schema holding THROW, as it might on one the model wrote.
vi.mock("@traverse/graph-core", async (original) => {
  const real = await original<typeof import("@traverse/graph-core")>();
  return {
    ...real,
    checkSchemaChange: (input: Parameters<typeof real.checkSchemaChange>[0]) => {
      if (input.proposed.some(({ sdl }) => sdl.includes("THROW"))) {
        throw new Error("composition failed on: test model text");
      }
      return real.checkSchemaChange(input);
    },
  };
});

describe("suggest, when composition throws", () => {
  it("[GR-12] reads a check that throws on the model's schema as invalid, with none of its text", async () => {
    const ask = vi.fn(() =>
      Promise.resolve({
        kind: "answer" as const,
        value: { sdl: "type Query { a: Int b: Int } # THROW", summary: "x" },
      }),
    );
    const assistant = {
      withCall: (_: string, work: (asking: typeof ask) => Promise<unknown>) => work(ask),
    } as unknown as Assistant;
    const graph = [{ name: "one", sdl: "type Query { a: Int b: Int }" }];
    const input = {
      subgraph: "one",
      drafts: { one: "type Query { a: Int }" },
      operations: "query B { b }",
      screens: "",
    };

    expect(await suggest(assistant, "user-1", graph, input)).toEqual({ kind: "invalid" });
  });

  it("[GR-12] reads a check that throws on the draft as nothing to fix", async () => {
    const ask = vi.fn();
    const assistant = {
      withCall: (_: string, work: (asking: typeof ask) => Promise<unknown>) => work(ask),
    } as unknown as Assistant;
    // The first test used one check; this one's draft check is the second, which throws.
    const graph = [{ name: "one", sdl: "type Query { a: Int b: Int }" }];
    const input = {
      subgraph: "one",
      drafts: { one: "type Query { a: Int } # THROW" },
      operations: "query B { b }",
      screens: "",
    };

    expect(await suggest(assistant, "user-1", graph, input)).toEqual({ kind: "nothing-to-fix" });
    expect(ask).not.toHaveBeenCalled();
  });
});
