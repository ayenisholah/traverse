import { describe, expect, it, vi } from "vitest";
import type { Assistant } from "../../../src/server/assistant/assistant.ts";
import demoImpact from "../../../src/generated/demo-impact.json" with { type: "json" };
import { handleApiRequest, type Context } from "../../../src/server/api.ts";

const token = (payload: object) =>
  `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.c2ln`;
const input = {
  kind: "composition",
  failed: "proposed",
  errors: ['Field "Mood.name" is defined twice.'],
};

const contextWith = ({
  accessToken,
  assistant,
}: {
  accessToken?: string;
  assistant?: Assistant;
}): Context => ({
  router: { run: vi.fn() },
  sandbox: { route: vi.fn() },
  canSignIn: true,
  accessToken,
  assistant,
});

const call = async (context: Context, body: unknown, path = "explain") => {
  const response = await handleApiRequest(
    new Request(`http://web.test/api/trpc/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    context,
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const explaining = () => {
  const ask = vi.fn(() =>
    Promise.resolve({
      kind: "answer" as const,
      value: {
        summary: "Defined twice.",
        points: [{ text: "Mood.name twice.", fields: ["Mood.name"] }],
      },
    }),
  );
  return { assistant: { ask } as unknown as Assistant, ask };
};

describe("the explain procedure", () => {
  it("[FR-AI-1] explains for a signed-in user, counted against their subject", async () => {
    const { assistant, ask } = explaining();
    const answer = await call(
      contextWith({ accessToken: token({ sub: "user-1" }), assistant }),
      input,
    );

    expect(answer.body).toMatchObject({
      result: { data: { kind: "explained", summary: "Defined twice." } },
    });
    expect((ask.mock.calls[0] as unknown as [string])[0]).toBe("user-1");
  });

  it("[GR-15] refuses someone signed out, and a token with no subject", async () => {
    const { assistant, ask } = explaining();

    expect((await call(contextWith({ assistant }), input)).status).toBe(401);
    expect((await call(contextWith({ accessToken: token({}), assistant }), input)).status).toBe(
      401,
    );
    expect(ask).not.toHaveBeenCalled();
  });

  it("[FR-AI-4] says the assistant is unavailable where the server has none", async () => {
    const answer = await call(contextWith({ accessToken: token({ sub: "user-1" }) }), input);

    expect(answer.body).toEqual({ result: { data: { kind: "unavailable" } } });
  });

  it.each([
    ["an unknown kind", { ...input, kind: "other" }],
    ["no errors", { ...input, errors: [] }],
    [
      "a field coordinate that isn't one",
      {
        kind: "impact",
        changes: [{ coordinate: "not a coordinate", kind: "removed", subgraphs: [] }],
        operations: [],
        screens: [],
      },
    ],
    ["a field nobody asked for", { ...input, extra: "x" }],
  ])("[GR-13] refuses a request with %s before any model sees it", async (_, body) => {
    const { assistant, ask } = explaining();

    expect(
      (await call(contextWith({ accessToken: token({ sub: "u" }), assistant }), body)).status,
    ).toBe(400);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("the suggest procedure", () => {
  // A draft of the demo graph's family subgraph that removes a field the operation reads.
  const family = demoImpact.subgraphs.find(({ name }) => name === "family")?.sdl ?? "";
  const draft = family.replaceAll(/\n\s*maritalStatus: MaritalStatus/g, "");
  const request = {
    subgraph: "family",
    drafts: { family: draft },
    operations: "query Status { employees { details { maritalStatus } } }",
    screens: "",
  };

  it("[FR-AI-2] checks a suggestion against the server's own copy of the demo graph", async () => {
    const ask = vi.fn(() =>
      Promise.resolve({
        kind: "answer" as const,
        value: { sdl: family, summary: "Keeps maritalStatus." },
      }),
    );
    const withCall = (_: string, work: (asking: typeof ask) => Promise<unknown>) => work(ask);
    const context = contextWith({
      accessToken: token({ sub: "user-1" }),
      assistant: { ask, withCall } as unknown as Assistant,
    });
    const answer = await call(context, request, "suggest");

    expect(answer.body).toMatchObject({
      result: { data: { kind: "suggested", brokenBefore: 1, brokenAfter: 0 } },
    });
  });

  it("[GR-15] refuses someone signed out, and says unavailable where there's no assistant", async () => {
    expect((await call(contextWith({}), request, "suggest")).status).toBe(401);
    expect(
      (await call(contextWith({ accessToken: token({ sub: "u" }) }), request, "suggest")).body,
    ).toEqual({ result: { data: { kind: "unavailable" } } });
    expect((await call(contextWith({ accessToken: token({}) }), request, "suggest")).status).toBe(
      401,
    );
  });

  it("[GR-15] reads a suggestion's drafts past the usual cap, but not without limit", async () => {
    const context = contextWith({ accessToken: token({ sub: "u" }) });
    // Five drafts near their own limit: far past the usual 32 KB, within the suggestion's cap.
    const near = `${family}\n# ${"x".repeat(20_000)}`;
    const big = {
      ...request,
      drafts: { family: near, hobbies: near, mood: near, products: near, countries: near },
    };
    const huge = { ...request, drafts: { family: "x".repeat(300_000) } };

    expect((await call(context, big, "suggest")).status).toBe(200);
    expect((await call(context, huge, "suggest")).status).toBe(413);
  });
});

describe("the draft procedure", () => {
  it("[FR-AI-3] drafts against the composed schema the editor checks", async () => {
    const ask = vi.fn(() =>
      Promise.resolve({
        kind: "answer" as const,
        value: {
          operation: 'query P { package(name: "express") { name } }',
          summary: "Reads express's name.",
        },
      }),
    );
    const context = contextWith({
      accessToken: token({ sub: "user-1" }),
      assistant: { ask } as unknown as Assistant,
    });

    expect((await call(context, { description: "express's name" }, "draft")).body).toMatchObject({
      result: { data: { kind: "drafted" } },
    });
  });

  it("[GR-15] refuses someone signed out, and an empty or long description", async () => {
    const context = contextWith({ accessToken: token({ sub: "u" }) });

    expect((await call(contextWith({}), { description: "x" }, "draft")).status).toBe(401);
    expect(
      (await call(contextWith({ accessToken: token({}) }), { description: "x" }, "draft")).status,
    ).toBe(401);
    expect((await call(context, { description: "  " }, "draft")).status).toBe(400);
    expect((await call(context, { description: "x".repeat(1_001) }, "draft")).status).toBe(400);
    expect((await call(context, { description: "x" }, "draft")).body).toEqual({
      result: { data: { kind: "unavailable" } },
    });
  });
});
