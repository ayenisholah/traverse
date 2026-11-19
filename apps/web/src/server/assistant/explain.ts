import { z } from "zod";
import type { Assistant } from "./assistant.ts";
import { asRead, isPlainText } from "./plain-text.ts";
import { fixed } from "./prompt.ts";

const text = (max: number) => z.string().max(max);
const COORDINATE = /^[A-Za-z_][A-Za-z0-9_]{0,99}\.[A-Za-z_][A-Za-z0-9_]{0,99}$/;

/** A schema check's result, as the impact check computed it in the browser. */
export const explainInput = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("composition"),
    failed: z.enum(["current", "proposed"]),
    errors: z.array(text(2_000)).min(1).max(30),
  }),
  z.strictObject({
    kind: z.literal("impact"),
    changes: z
      .array(
        z.strictObject({
          coordinate: z.string().regex(COORDINATE),
          kind: text(40),
          subgraphs: z.array(text(100)).max(10),
        }),
      )
      .max(100),
    operations: z
      .array(
        z.strictObject({
          name: text(200),
          fields: z.array(z.string().regex(COORDINATE)).max(100),
          errors: z.array(text(2_000)).max(20),
        }),
      )
      .max(50),
    screens: z
      .array(z.strictObject({ name: text(200), operations: z.array(text(200)).max(50) }))
      .max(50),
  }),
]);

export type ExplainInput = z.infer<typeof explainInput>;

const answerText = z.string().min(1).max(500);
const explanationSchema = z.strictObject({
  summary: answerText,
  points: z
    .array(z.strictObject({ text: answerText, fields: z.array(z.string().max(201)).max(6) }))
    .min(1)
    .max(8),
});

type Explanation = z.infer<typeof explanationSchema>;

export type ExplainAnswer =
  | ({ kind: "explained" } & Explanation)
  | { kind: "invalid" }
  | { kind: "limit" }
  | { kind: "too-large" }
  | { kind: "unavailable" };

const TASK = fixed`Explain the result of a GraphQL schema check to a frontend developer, in plain words. Name the exact fields involved as Type.field coordinates.`;
const INSTRUCTIONS = fixed`Explain the result in the data block: what broke, why, and which operations and screens it affects. Give a one-sentence summary, then up to eight short points. Name fields only as Type.field coordinates that appear in the result, and list the ones each point is about in its "fields". Write plain sentences: no markdown, no links, no web or email addresses, no code, and no abbreviations with dots.`;

const COORDINATE_IN_TEXT = /\b[A-Za-z_][A-Za-z0-9_]{0,99}\.[A-Za-z_][A-Za-z0-9_]{0,99}\b/g;
// In free error text, only a capitalised type, so "www.example" or "e.g" can't pass for a field.
const TYPE_FIELD = /^[A-Z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

/** Every coordinate the result itself names: the only fields an explanation may name (GR-12). */
const fieldsIn = (input: ExplainInput): Set<string> => {
  if (input.kind === "composition") {
    const named = input.errors.flatMap((error) => error.match(COORDINATE_IN_TEXT) ?? []);
    return new Set(named.filter((coordinate) => TYPE_FIELD.test(coordinate)));
  }
  return new Set([
    ...input.changes.map(({ coordinate }) => coordinate),
    ...input.operations.flatMap(({ fields }) => fields),
  ]);
};

/**
 * Whether the explanation is about this result (GR-12):
 * - every field it names, in its lists or its sentences, is one the result names;
 * - if the result names any field, the explanation names at least one;
 * - nothing in it is a link, an address, markup, or anything a token or email scrub would remove.
 * Anything else is never shown.
 */
const isAbout = (explanation: Explanation, known: Set<string>): boolean => {
  const texts = [explanation.summary, ...explanation.points.map(({ text: point }) => point)];
  const listed = explanation.points.flatMap(({ fields }) => fields.map(asRead));
  const named = [
    ...listed,
    ...texts.flatMap((line) => asRead(line).match(COORDINATE_IN_TEXT) ?? []),
  ];
  return (
    named.every((field) => known.has(field)) &&
    (known.size === 0 || listed.some((field) => known.has(field))) &&
    [...texts, ...listed].every(isPlainText)
  );
};

/** Explains a schema check's result in plain words (FR-AI-1), or says why it couldn't. */
export const explain = async (
  assistant: Assistant,
  userId: string,
  input: ExplainInput,
): Promise<ExplainAnswer> => {
  const outcome = await assistant.ask(userId, {
    task: TASK,
    instructions: INSTRUCTIONS,
    // Compact, so the data stays within what the body cap already bounds (GR-15).
    data: { result: JSON.stringify(input) },
    schema: explanationSchema,
  });
  if (outcome.kind !== "answer") return { kind: outcome.kind };
  return isAbout(outcome.value, fieldsIn(input))
    ? { kind: "explained", ...outcome.value }
    : { kind: "invalid" };
};
