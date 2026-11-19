import { describe, expect, it, vi } from "vitest";
import type { Assistant } from "../../../src/server/assistant/assistant.ts";
import { suggest } from "../../../src/server/assistant/suggest.ts";

const graph = [
  { name: "people", sdl: "type Query { person: Person }\ntype Person { name: String age: Int }" },
  { name: "pets", sdl: "type Query { pet: String }" },
];
const operations = "query Name { person { name } }\nquery Age { person { age } }";
const withoutAge = "type Query { person: Person }\ntype Person { name: String }";
const input = { subgraph: "people", drafts: { people: withoutAge }, operations, screens: "" };

/** An assistant whose one call answers `value`, and that records the call being taken. */
const answering = (value: unknown) => {
  const ask = vi.fn(() => Promise.resolve({ kind: "answer" as const, value }));
  const withCall = vi.fn((_: string, work: (asking: typeof ask) => Promise<unknown>) => work(ask));
  return { assistant: { ask: vi.fn(), withCall } as unknown as Assistant, ask, withCall };
};

const deprecateAge = {
  sdl: 'type Query { person: Person }\ntype Person { name: String age: Int @deprecated(reason: "Use name") }',
  summary: "Keeps age, marked deprecated, so the Age operation still works.",
};

describe("suggest", () => {
  it("[FR-AI-2] shows a change that composes and breaks fewer operations than the draft", async () => {
    const { assistant, ask } = answering(deprecateAge);

    expect(await suggest(assistant, "user-1", graph, input)).toEqual({
      kind: "suggested",
      ...deprecateAge,
      brokenBefore: 1,
      brokenAfter: 0,
    });
    const [question] = ask.mock.calls[0] as unknown as [
      { data: Record<string, string>; maxTokens: number },
    ];
    expect(question.maxTokens).toBe(8_192);
    expect(question.data["current-schema"]).toBe(graph[0]?.sdl);
    expect(question.data["draft-schema"]).toBe(withoutAge);
    expect(question.data.problems).toContain('"name":"Age"');
  });

  it("[FR-AI-2] shows a change that composes where the draft didn't", async () => {
    const { assistant } = answering(deprecateAge);
    const broken = { ...input, drafts: { people: "type Query { person: Person" } };

    expect(await suggest(assistant, "user-1", graph, broken)).toMatchObject({
      kind: "suggested",
      brokenBefore: 0,
      brokenAfter: 0,
    });
  });

  it.each([
    ["doesn't compose", { sdl: "type Query { person: Person", summary: "x" }],
    ["breaks as many operations as the draft", { sdl: withoutAge, summary: "Same as yours." }],
    [
      "breaks an operation the draft didn't",
      { sdl: "type Query { person: Person }\ntype Person { age: Int }", summary: "Swapped them." },
    ],
    ["has a link in its summary", { ...deprecateAge, summary: "See https://evil.example." }],
    [
      "adds a link in a comment",
      { ...deprecateAge, sdl: `# see https://evil.example/login\n${deprecateAge.sdl}` },
    ],
    [
      "adds an email in a description",
      { ...deprecateAge, sdl: `"""Ask test-person@example.com"""\n${deprecateAge.sdl}` },
    ],
    [
      "carries a scrubbed marker into the draft",
      { ...deprecateAge, sdl: `"""Owner [email removed]"""\n${deprecateAge.sdl}` },
    ],
  ])("[GR-12] never shows a suggestion that %s", async (_, value) => {
    expect(await suggest(answering(value).assistant, "user-1", graph, input)).toEqual({
      kind: "invalid",
    });
  });

  it("[GR-15] counts a draft that breaks nothing, but asks no model about it", async () => {
    const { assistant, ask, withCall } = answering(deprecateAge);
    const clean = { ...input, drafts: { people: graph[0]?.sdl ?? "" } };

    expect(await suggest(assistant, "user-1", graph, clean)).toEqual({ kind: "nothing-to-fix" });
    expect(withCall).toHaveBeenCalledWith("user-1", expect.any(Function));
    expect(ask).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a subgraph the graph doesn't have",
      { ...input, subgraph: "nope", drafts: { nope: "x" } },
      "nothing-to-fix",
    ],
    ["no draft of the subgraph", { ...input, drafts: {} }, "nothing-to-fix"],
    [
      "operations that share a name",
      { ...input, operations: "query A { person { name } } query A { person { age } }" },
      "duplicate-names",
    ],
    [
      "more operations than a suggestion checks",
      {
        ...input,
        operations: Array.from(
          { length: 51 },
          (_, i) => `query Q${String(i)} { person { name } }`,
        ).join("\n"),
      },
      "too-large",
    ],
  ] as const)("[GR-15] composes nothing and counts nothing for %s", async (_, request, kind) => {
    const { assistant, withCall } = answering(deprecateAge);

    expect(await suggest(assistant, "user-1", graph, request)).toEqual({ kind });
    expect(withCall).not.toHaveBeenCalled();
  });

  it("[GR-15] counts nothing for a subgraph too large to come back in one answer", async () => {
    const { assistant, withCall } = answering(deprecateAge);
    const big = [{ name: "people", sdl: `${graph[0]?.sdl ?? ""}\n# ${"x".repeat(24_000)}` }];

    expect(await suggest(assistant, "user-1", big, input)).toEqual({ kind: "too-large" });
    expect(withCall).not.toHaveBeenCalled();
  });

  it("[GR-15] passes on the limit, and composes nothing past it", async () => {
    const assistant = {
      withCall: () => Promise.resolve({ kind: "limit" }),
    } as unknown as Assistant;

    expect(await suggest(assistant, "user-1", graph, input)).toEqual({ kind: "limit" });
  });

  it.each(["too-large", "unavailable"] as const)(
    "[FR-AI-4] passes on %s when there's no answer",
    async (kind) => {
      const assistant = {
        withCall: (_: string, work: (ask: () => Promise<unknown>) => Promise<unknown>) =>
          work(() => Promise.resolve({ kind })),
      } as unknown as Assistant;

      expect(await suggest(assistant, "user-1", graph, input)).toEqual({ kind });
    },
  );

  it("[GR-12] never shows a suggestion that fixes what the draft broke but breaks something else", async () => {
    const three = {
      ...graph[0],
      sdl: "type Query { person: Person }\ntype Person { name: String age: Int nick: String }",
    };
    const draft = "type Query { person: Person }\ntype Person { name: String }";
    const request = {
      subgraph: "people",
      drafts: { people: draft },
      operations:
        "query Name { person { name } }\nquery Age { person { age } }\nquery Nick { person { nick } }",
      screens: "",
    };
    const fixesTwoBreaksOne = {
      sdl: "type Query { person: Person }\ntype Person { age: Int nick: String }",
      summary: "Keeps age and nick.",
    };

    expect(
      await suggest(
        answering(fixesTwoBreaksOne).assistant,
        "user-1",
        [three as (typeof graph)[number], graph[1] as (typeof graph)[number]],
        request,
      ),
    ).toEqual({ kind: "invalid" });
  });
});
