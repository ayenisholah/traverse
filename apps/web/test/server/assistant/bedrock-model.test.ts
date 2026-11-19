import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { startModelStub, type ModelStub } from "../../../../../router/test/support/model-stub.ts";
import { createBedrockModel } from "../../../src/server/assistant/bedrock-model.ts";

let stub: ModelStub;

beforeAll(async () => {
  stub = await startModelStub();
});

afterAll(async () => {
  await stub.stop();
});

beforeEach(() => {
  stub.calls.length = 0;
});

const schema = z.strictObject({ summary: z.string().max(200) });
const model = (timeoutMs?: number) =>
  createBedrockModel({
    client: new BedrockRuntimeClient({
      region: "eu-north-1",
      endpoint: stub.url,
      maxAttempts: 1,
      credentials: { accessKeyId: "test-key", secretAccessKey: "test-secret" },
    }),
    modelId: "eu.test.model-v1:0",
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
const ask = (timeoutMs?: number) =>
  model(timeoutMs).ask({ system: "test system", prompt: "test prompt", schema });

describe("createBedrockModel", () => {
  it("[FR-AI-1] asks through Converse, forcing the one answer tool, with a set token limit", async () => {
    stub.reply({ kind: "tool", input: { summary: "It broke." } });

    expect(await ask()).toEqual({ kind: "answer", value: { summary: "It broke." } });
    const [call] = stub.calls;
    expect(call).toMatchObject({
      modelId: "eu.test.model-v1:0",
      system: "test system",
      prompt: "test prompt",
      toolChoice: { tool: { name: "answer" } },
      maxTokens: 2048,
    });
    expect(call?.toolSchema).toMatchObject({
      type: "object",
      properties: { summary: { type: "string", maxLength: 200 } },
      additionalProperties: false,
    });
  });

  it.each([
    ["a field the schema doesn't have", { kind: "tool", input: { summary: "x", extra: 1 } }],
    ["a value over its limit", { kind: "tool", input: { summary: "x".repeat(201) } }],
    ["another tool", { kind: "tool", input: { summary: "x" }, name: "run_sql" }],
    ["plain text instead of the tool", { kind: "text", text: '{"summary":"x"}' }],
  ] as const)("[GR-12] never passes on an answer with %s", async (_, reply) => {
    stub.reply(reply);

    expect(await ask()).toEqual({ kind: "unavailable", reason: "invalid" });
  });

  it.each([
    ["ThrottlingException", 429, "throttled"],
    ["ServiceQuotaExceededException", 400, "throttled"],
    ["ModelTimeoutException", 408, "timeout"],
    ["AccessDeniedException", 403, "refused"],
    ["ValidationException", 400, "refused"],
    ["ResourceNotFoundException", 404, "refused"],
    ["InternalServerException", 500, "error"],
  ] as const)(
    "[FR-AI-4] reads Bedrock's %s as %s, and keeps nothing it said",
    async (type, status, reason) => {
      stub.reply({ kind: "error", status, type });

      expect(await ask()).toEqual({ kind: "unavailable", reason });
    },
  );

  it("[FR-AI-4] gives up on a model that doesn't answer in time", async () => {
    stub.reply({ kind: "hang" });

    expect(await ask(200)).toEqual({ kind: "unavailable", reason: "timeout" });
  });

  it("[FR-AI-4] reads a failure that isn't even an object as an error", async () => {
    const odd = createBedrockModel({
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the odd case under test
      client: { send: () => Promise.reject(null) },
      modelId: "eu.test.model-v1:0",
    });

    expect(await odd.ask({ system: "s", prompt: "p", schema })).toEqual({
      kind: "unavailable",
      reason: "error",
    });
  });

  it("[FR-AI-4] reads a failure with no name as an error", async () => {
    const broken = createBedrockModel({
      client: { send: () => Promise.reject(Object.assign(new Error("test"), { name: undefined })) },
      modelId: "eu.test.model-v1:0",
    });

    expect(await broken.ask({ system: "s", prompt: "p", schema })).toEqual({
      kind: "unavailable",
      reason: "error",
    });
  });
});
