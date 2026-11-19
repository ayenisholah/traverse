import { describe, expect, it, vi } from "vitest";
import type { Assistant } from "../../../src/server/assistant/assistant.ts";
import { explain, type ExplainInput } from "../../../src/server/assistant/explain.ts";

const impact: ExplainInput = {
  kind: "impact",
  changes: [{ coordinate: "Details.maritalStatus", kind: "removed", subgraphs: ["family"] }],
  operations: [
    {
      name: "Employee",
      fields: ["Details.maritalStatus", "Query.employee"],
      errors: ['Cannot query field "maritalStatus" on type "Details".'],
    },
  ],
  screens: [{ name: "Profile", operations: ["Employee"] }],
};
const composition: ExplainInput = {
  kind: "composition",
  failed: "proposed",
  errors: ['Field "Mood.name" is defined in two subgraphs, with different types.'],
};

const answering = (value: unknown) => {
  const ask = vi.fn(() => Promise.resolve({ kind: "answer" as const, value }));
  return { assistant: { ask } as unknown as Assistant, ask };
};
const point = (text: string, fields: string[]) => ({ text, fields });

describe("explain", () => {
  it("[FR-AI-1] explains a result in points that name its real fields", async () => {
    const value = {
      summary: "Removing maritalStatus breaks the Employee operation.",
      points: [point("Details.maritalStatus was removed from family.", ["Details.maritalStatus"])],
    };
    const { assistant, ask } = answering(value);

    expect(await explain(assistant, "user-1", impact)).toEqual({ kind: "explained", ...value });
    const [, question] = ask.mock.calls[0] as unknown as [string, { data: { result: string } }];
    expect(JSON.parse(question.data.result)).toEqual(impact);
  });

  it("[FR-AI-1] knows the fields a composition error names", async () => {
    const value = {
      summary: "Two subgraphs disagree.",
      points: [point("Mood.name differs.", ["Mood.name"])],
    };

    expect(await explain(answering(value).assistant, "user-1", composition)).toMatchObject({
      kind: "explained",
    });
  });

  it("[GR-12] lets an explanation of an error that names no field name none", async () => {
    const plain: ExplainInput = {
      kind: "composition",
      failed: "proposed",
      errors: ["Syntax Error"],
    };
    const value = { summary: "The draft has a syntax error.", points: [point("Check it.", [])] };

    expect(await explain(answering(value).assistant, "user-1", plain)).toMatchObject({
      kind: "explained",
    });
  });

  it.each([
    ["a field the result doesn't name", { summary: "x", points: [point("y", ["Secret.token"])] }],
    ["a link", { summary: "Read https://evil.example to fix it.", points: [point("y", [])] }],
    ["a bare web address", { summary: "x", points: [point("See www.evil.example", [])] }],
    ["markup", { summary: "<img src=x onerror=alert(1)>", points: [point("y", [])] }],
    ["a markdown link", { summary: "x", points: [point("[fix](javascript:alert(1))", [])] }],
    ["code", { summary: "Run `rm -rf /`", points: [point("y", [])] }],
    [
      "a field named only in its words",
      {
        summary: "Removing Query.adminToken leaks Billing.cardNumber.",
        points: [point("Details.maritalStatus is gone.", ["Details.maritalStatus"])],
      },
    ],
    [
      "no field at all, about a result that names some",
      { summary: "Ship it.", points: [point("Done.", [])] },
    ],
    [
      "a bare domain",
      { summary: "x", points: [point("Visit evil.example/fix.", ["Details.maritalStatus"])] },
    ],
    [
      "a fullwidth link",
      { summary: "ｈｔｔｐｓ：／／evil.example", points: [point("y", ["Details.maritalStatus"])] },
    ],
    ["a mailto link", { summary: "mailto:a@b.c", points: [point("y", ["Details.maritalStatus"])] }],
    [
      "a script link",
      { summary: "javascript:alert(1)", points: [point("y", ["Details.maritalStatus"])] },
    ],
    [
      "a link with an invisible character in it",
      { summary: "h\u200Bttps://x", points: [point("y", ["Details.maritalStatus"])] },
    ],
    ["spaced markup", { summary: "< script>", points: [point("y", ["Details.maritalStatus"])] }],
    [
      "bold markdown",
      { summary: "**Run** this.", points: [point("y", ["Details.maritalStatus"])] },
    ],
    [
      "an email address",
      {
        summary: "Contact someone",
        points: [point("Mail test-person@example.org.", ["Details.maritalStatus"])],
      },
    ],
    [
      "a link in a field list",
      { summary: "x", points: [point("y", ["Details.maritalStatus", "https://evil.example"])] },
    ],
  ])("[GR-12] never shows an explanation with %s", async (_, value) => {
    expect(await explain(answering(value).assistant, "user-1", impact)).toEqual({
      kind: "invalid",
    });
  });

  it("[GR-12] takes no web address in an error for a field the result names", async () => {
    const result: ExplainInput = {
      kind: "composition",
      failed: "proposed",
      errors: ["See www.evil for help, e.g. on Mood.name."],
    };
    const ask = (fields: string[]) =>
      explain(
        answering({ summary: "x", points: [point("y", fields)] }).assistant,
        "user-1",
        result,
      );

    expect(await ask(["www.evil"])).toEqual({ kind: "invalid" });
    expect(await ask(["Mood.name"])).toMatchObject({ kind: "explained" });
  });

  it("[GR-15] sends the result as compact JSON", async () => {
    const { assistant, ask } = answering({
      summary: "x",
      points: [point("y", ["Details.maritalStatus"])],
    });
    await explain(assistant, "user-1", impact);
    const [, question] = ask.mock.calls[0] as unknown as [string, { data: { result: string } }];

    expect(question.data.result).toBe(JSON.stringify(impact));
  });

  it.each(["limit", "too-large", "unavailable"] as const)(
    "[FR-AI-4] passes on %s when there's no answer",
    async (kind) => {
      const assistant = { ask: () => Promise.resolve({ kind }) } as unknown as Assistant;

      expect(await explain(assistant, "user-1", impact)).toEqual({ kind });
    },
  );
});
