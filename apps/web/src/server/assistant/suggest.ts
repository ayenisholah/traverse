import {
  checkSchemaChange,
  splitOperations,
  type SchemaChangeFailure,
  type SchemaChangeReport,
  type SubgraphInput,
} from "@traverse/graph-core";
import { z } from "zod";
import { parseScreens } from "../../impact/check-request.ts";
import type { Assistant } from "./assistant.ts";
import { isPlainText } from "./plain-text.ts";
import { fixed } from "./prompt.ts";

const SUBGRAPH = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
// A whole schema must fit one answer: about 30 KB at the answer's token limit, with room to spare.
const MAX_SCHEMA_LENGTH = 24_000;
const ANSWER_TOKENS = 8_192;
const MAX_DRAFTS = 5;
const MAX_OPERATIONS = 50;

/** The user's side of an impact check. The graph it's checked against is the server's own. */
export const suggestInput = z.strictObject({
  subgraph: z.string().regex(SUBGRAPH),
  drafts: z
    .record(z.string().regex(SUBGRAPH), z.string().max(MAX_SCHEMA_LENGTH))
    .refine((drafts) => Object.keys(drafts).length <= MAX_DRAFTS),
  operations: z.string().max(50_000),
  screens: z.string().max(10_000),
});

type SuggestInput = z.infer<typeof suggestInput>;

const suggestionSchema = z.strictObject({
  sdl: z.string().min(1).max(MAX_SCHEMA_LENGTH),
  summary: z.string().min(1).max(300),
});

export type SuggestAnswer =
  | { kind: "suggested"; sdl: string; summary: string; brokenBefore: number; brokenAfter: number }
  | { kind: "nothing-to-fix" }
  | { kind: "duplicate-names" }
  | { kind: "invalid" }
  | { kind: "limit" }
  | { kind: "too-large" }
  | { kind: "unavailable" };

const TASK = fixed`Propose a change to one subgraph's GraphQL schema that keeps a frontend team's operations working. The change is checked by real composition before anyone sees it.`;
const INSTRUCTIONS = fixed`The data holds one subgraph's current schema, the developer's draft of it, and what the draft breaks. Write a revised schema for that subgraph that keeps what the draft is trying to do, but that composes with the rest of the graph and breaks none of the listed operations: for example, keep a removed field and mark it @deprecated instead. Answer with the whole revised schema in "sdl", adding no comments, and one plain sentence saying what you changed in "summary", with no links, markdown or code.`;

interface Checked {
  report: SchemaChangeReport | SchemaChangeFailure;
  broken: Set<string>;
}

/**
 * The real check, as the impact page runs it, with these drafts on the server's own graph. A
 * check that throws, say on a schema the model wrote, is no check, never an error with its text.
 */
const check = (
  graph: SubgraphInput[],
  drafts: Record<string, string>,
  input: SuggestInput,
): Checked | undefined => {
  try {
    return checked(graph, drafts, input);
  } catch {
    return undefined;
  }
};

const checked = (
  graph: SubgraphInput[],
  drafts: Record<string, string>,
  input: SuggestInput,
): Checked => {
  const report = checkSchemaChange({
    current: graph,
    proposed: graph.map((subgraph) => ({
      ...subgraph,
      sdl: drafts[subgraph.name] ?? subgraph.sdl,
    })),
    operations: splitOperations(input.operations),
    screens: parseScreens(input.screens),
  });
  const broken = report.success
    ? new Set(report.operations.filter(({ errors }) => errors.length > 0).map(({ name }) => name))
    : new Set<string>();
  return { report, broken };
};

const problemsOf = ({ report }: Checked) =>
  report.success
    ? JSON.stringify({ changes: report.changes, operations: report.operations })
    : JSON.stringify({ composes: false, errors: report.errors });

/**
 * A suggestion is shown only if real composition says it's safer (GR-12): it composes, it breaks
 * none of the operations the draft didn't already break, and it breaks fewer than the draft did,
 * or the draft didn't compose at all.
 */
const isSafer = (draft: Checked, suggested: Checked): boolean => {
  if (!suggested.report.success) return false;
  const newlyBroken = [...suggested.broken].some((name) => !draft.broken.has(name));
  if (newlyBroken) return false;
  return !draft.report.success || suggested.broken.size < draft.broken.size;
};

// Text the scrubber puts in place of what it removed. A schema holding one would rewrite the user's
// own draft with it.
const SCRUBBED = /\[(?:token|key|email) removed\]/;

/**
 * Every line the suggestion adds, that neither the draft nor the current schema has, must be
 * plain: no link, address, markup or secret shape in a new description, comment or argument, and
 * nothing the scrubber wrote (GR-12, GR-16).
 */
const addsOnlyPlainLines = (sdl: string, ...known: string[]): boolean => {
  const existing = new Set(known.flatMap((text) => text.split("\n").map((line) => line.trim())));
  return sdl
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !existing.has(line))
    .every((line) => isPlainText(line) && !SCRUBBED.test(line));
};

/** Whether each operation has its own name, so each one's result is its own; none if too many. */
const hasUniqueNames = (operations: string): boolean | undefined => {
  const names = splitOperations(operations).map(({ name }) => name);
  if (names.length > MAX_OPERATIONS) return undefined;
  return new Set(names).size === names.length;
};

/** Suggests a safe change for a breaking draft (FR-AI-2), or says why it couldn't. */
export const suggest = async (
  assistant: Assistant,
  userId: string,
  graph: SubgraphInput[],
  input: SuggestInput,
): Promise<SuggestAnswer> => {
  const current = graph.find(({ name }) => name === input.subgraph);
  const draftSdl = input.drafts[input.subgraph];
  if (current === undefined || draftSdl === undefined) return { kind: "nothing-to-fix" };
  // Everything cheap first, so nothing costly runs for a request that couldn't be answered.
  if (current.sdl.length > MAX_SCHEMA_LENGTH) return { kind: "too-large" };
  const unique = hasUniqueNames(input.operations);
  if (unique === undefined) return { kind: "too-large" };
  if (!unique) return { kind: "duplicate-names" };

  // Composition is the costly part, so it runs only inside a counted call (GR-15).
  return assistant.withCall(userId, async (ask): Promise<SuggestAnswer> => {
    const draft = check(graph, input.drafts, input);
    if (draft === undefined || (draft.report.success && draft.broken.size === 0)) {
      return { kind: "nothing-to-fix" };
    }
    const outcome = await ask({
      task: TASK,
      instructions: INSTRUCTIONS,
      data: {
        "current-schema": current.sdl,
        "draft-schema": draftSdl,
        problems: problemsOf(draft),
      },
      schema: suggestionSchema,
      maxTokens: ANSWER_TOKENS,
    });
    if (outcome.kind !== "answer") return { kind: outcome.kind };
    const { sdl, summary } = outcome.value;
    const suggested = check(graph, { ...input.drafts, [input.subgraph]: sdl }, input);
    const safe =
      suggested !== undefined &&
      isSafer(draft, suggested) &&
      isPlainText(summary) &&
      addsOnlyPlainLines(sdl, draftSdl, current.sdl);
    if (!safe) return { kind: "invalid" };
    return {
      kind: "suggested",
      sdl,
      summary,
      brokenBefore: draft.broken.size,
      brokenAfter: suggested.broken.size,
    };
  });
};
