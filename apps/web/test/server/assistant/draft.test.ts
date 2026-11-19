import { describe, expect, it, vi } from "vitest";
import type { Assistant } from "../../../src/server/assistant/assistant.ts";
import { createDraft } from "../../../src/server/assistant/draft.ts";

const schema =
  "type Query { package(name: String!): Package }\ntype Package { name: String! license: String }";
const draft = createDraft(schema);
const answering = (value: unknown) => {
  const ask = vi.fn(() => Promise.resolve({ kind: "answer" as const, value }));
  return { assistant: { ask } as unknown as Assistant, ask };
};

describe("draft", () => {
  it("[FR-AI-3] drafts a query that validates, from the user's words read as data", async () => {
    const value = {
      operation: 'query License { package(name: "react") { name license } }',
      summary: "Reads react's licence.",
    };
    const { assistant, ask } = answering(value);

    expect(await draft(assistant, "user-1", { description: "react's licence" })).toEqual({
      kind: "drafted",
      operation: 'query License {\n  package(name: "react") {\n    name\n    license\n  }\n}',
      summary: value.summary,
    });
    const [, question] = ask.mock.calls[0] as unknown as [string, { data: Record<string, string> }];
    expect(question.data).toEqual({ schema, request: "react's licence" });
  });

  it.each([
    ["doesn't validate", { operation: 'query Q { package(name: "x") { stars } }', summary: "x" }],
    ["writes data", { operation: 'mutation M { package(name: "x") { name } }', summary: "x" }],
    [
      "has a link in its summary",
      { operation: 'query Q { package(name: "x") { name } }', summary: "See https://evil.example" },
    ],
  ])("[GR-12] never puts in the editor an operation that %s", async (_, value) => {
    expect(await draft(answering(value).assistant, "user-1", { description: "x" })).toEqual({
      kind: "invalid",
    });
  });

  it.each(["limit", "too-large", "unavailable"] as const)(
    "[FR-AI-4] passes on %s when there's no answer",
    async (kind) => {
      const assistant = { ask: () => Promise.resolve({ kind }) } as unknown as Assistant;

      expect(await draft(assistant, "user-1", { description: "x" })).toEqual({ kind });
    },
  );
});
