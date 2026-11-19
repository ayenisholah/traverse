import { z } from "zod";
import type { Assistant } from "./assistant.ts";
import { createOperationCheck } from "./operation-check.ts";
import { isPlainText } from "./plain-text.ts";
import { fixed } from "./prompt.ts";

export const draftInput = z.strictObject({ description: z.string().trim().min(1).max(1_000) });

type DraftInput = z.infer<typeof draftInput>;

const draftSchema = z.strictObject({
  operation: z.string().min(1).max(5_000),
  summary: z.string().min(1).max(300),
});

export type DraftAnswer =
  | { kind: "drafted"; operation: string; summary: string }
  | { kind: "invalid" }
  | { kind: "limit" }
  | { kind: "too-large" }
  | { kind: "unavailable" };

const TASK = fixed`Write one GraphQL query for a frontend developer, against the schema given. It is checked against the schema and the router's limits before anyone sees it.`;
const INSTRUCTIONS = fixed`The data holds the schema and what the developer wants to read. Write one named query, with no fragments and no aliases, that asks for just that, using only fields the schema has, at most three levels deep, with at most three top-level fields. Put the query in "operation", and one plain sentence saying what it reads in "summary", with no links, markdown or code.`;

/**
 * Drafts an operation from a description (FR-AI-3). It reaches the editor only if it's one query
 * that validates against the schema and fits the routers' limits (GR-12), or the page says why not.
 */
export const createDraft = (schemaSdl: string) => {
  const isRunnable = createOperationCheck(schemaSdl);
  return async (assistant: Assistant, userId: string, input: DraftInput): Promise<DraftAnswer> => {
    const outcome = await assistant.ask(userId, {
      task: TASK,
      instructions: INSTRUCTIONS,
      data: { schema: schemaSdl, request: input.description },
      schema: draftSchema,
    });
    if (outcome.kind !== "answer") return { kind: outcome.kind };
    const { operation, summary } = outcome.value;
    // The editor gets the check's own printing of the query, never the model's text as it came.
    const runnable = isRunnable(operation);
    return runnable !== undefined && isPlainText(summary)
      ? { kind: "drafted", operation: runnable, summary }
      : { kind: "invalid" };
  };
};
