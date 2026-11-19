import { describe, expect, it, vi } from "vitest";
import type { Assistant } from "../../../src/server/assistant/assistant.ts";
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

const call = async (context: Context, body: unknown) => {
  const response = await handleApiRequest(
    new Request("http://web.test/api/trpc/explain", {
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
