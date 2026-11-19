import { ConverseCommand, type BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import type { Model, Unavailable } from "./model.ts";

interface Options {
  client: Pick<BedrockRuntimeClient, "send">;
  modelId: string;
  /** Set explicitly, or Bedrock reserves the model's maximum against the quota (A-15). */
  maxTokens?: number;
  timeoutMs?: number;
}

const TOOL = "answer";
const DEFAULT_MAX_TOKENS = 2_048;
const DEFAULT_TIMEOUT_MS = 20_000;

const RETRYABLE = new Set(["ThrottlingException", "ServiceQuotaExceededException"]);
const TIMEOUTS = new Set(["ModelTimeoutException", "AbortError", "TimeoutError"]);
const REFUSALS = new Set([
  "AccessDeniedException",
  "ValidationException",
  "ResourceNotFoundException",
]);

const reasonFor = (error: unknown): Unavailable => {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  if (typeof name !== "string") return "error";
  if (RETRYABLE.has(name)) return "throttled";
  if (TIMEOUTS.has(name)) return "timeout";
  if (REFUSALS.has(name)) return "refused";
  return "error";
};

/**
 * Asks a model on Amazon Bedrock through Converse (A-15). The answer must come through one forced
 * tool whose input schema is the caller's, so the model has no way to answer in free text, and
 * whatever it puts in that tool is parsed again here before anyone sees it (GR-12).
 */
export const createBedrockModel = ({
  client,
  modelId,
  maxTokens = DEFAULT_MAX_TOKENS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: Options): Model => ({
  ask: async ({ system, prompt, schema, maxTokens: forThisCall }) => {
    try {
      const response = await client.send(
        new ConverseCommand({
          modelId,
          system: [{ text: system }],
          messages: [{ role: "user", content: [{ text: prompt }] }],
          inferenceConfig: { maxTokens: forThisCall ?? maxTokens, temperature: 0 },
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: TOOL,
                  description: "Give the answer. This is the only way to answer.",
                  // What the model writes is what the schema parses, so the tool takes its input view.
                  inputSchema: { json: z.toJSONSchema(schema, { io: "input" }) as never },
                },
              },
            ],
            toolChoice: { tool: { name: TOOL } },
          },
        }),
        { abortSignal: AbortSignal.timeout(timeoutMs) },
      );
      const use = response.output?.message?.content?.find(
        (block) => block.toolUse?.name === TOOL,
      )?.toolUse;
      const parsed = schema.safeParse(use?.input);
      return parsed.success
        ? { kind: "answer", value: parsed.data }
        : { kind: "unavailable", reason: "invalid" };
    } catch (error) {
      return { kind: "unavailable", reason: reasonFor(error) };
    }
  },
});
