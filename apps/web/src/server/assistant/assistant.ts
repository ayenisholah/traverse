import { decodeJwt } from "jose";
import { z } from "zod";
import type { Limits } from "./limits.ts";
import type { Model } from "./model.ts";
import { buildPrompt, fitsOneCall, SYSTEM_RULES, type Fixed } from "./prompt.ts";

interface Question<T> {
  /** What this task is, added to the rules every task shares. Only `fixed` text (GR-13). */
  task: Fixed;
  instructions: Fixed;
  /** User and upstream text, which the model reads only as data (GR-13). */
  data: Record<string, string>;
  /** Strict, so an answer with anything extra is refused rather than trimmed (GR-12). */
  schema: z.ZodType<T>;
}

type Outcome<T> =
  | { kind: "answer"; value: T }
  | { kind: "limit" }
  | { kind: "too-large" }
  | { kind: "unavailable" };

export interface Assistant {
  ask: <T>(userId: string, question: Question<T>) => Promise<Outcome<T>>;
}

/**
 * The signed-in user's subject, from the access token this server holds. It came from the user
 * pool's token endpoint to this server, and lives in a cookie only this server can seal, so the
 * browser can't have written it (ADR 0022). It only keys the user's limit.
 */
export const subjectOf = (accessToken: string): string | undefined => {
  try {
    const { sub } = decodeJwt(accessToken);
    return typeof sub === "string" && sub !== "" ? sub : undefined;
  } catch {
    return undefined;
  }
};

// Every object in an answer must refuse extra fields, or a schema would quietly trim them (GR-12).
const isStrict = (schema: z.ZodType): boolean => {
  const objects: unknown[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    if ((node as { type?: unknown }).type === "object") objects.push(node);
    for (const child of Object.values(node)) walk(child);
  };
  // The input view: what an answer may hold before parsing, which is where extra fields show.
  walk(z.toJSONSchema(schema, { io: "input" }));
  return objects.every(
    (node) => (node as { additionalProperties?: unknown }).additionalProperties === false,
  );
};

/**
 * Every call goes through here: the size is checked, the user's limit is taken (GR-15), the data
 * is fenced and scrubbed (GR-13, GR-14), and only an answer that parsed comes back (GR-12).
 * Nothing about a call is logged.
 */
export const createAssistant = ({
  model,
  limits,
}: {
  model: Model;
  limits: Limits;
}): Assistant => ({
  ask: async (userId, { task, instructions, data, schema }) => {
    if (!isStrict(schema)) throw new Error("An answer schema must be strict");
    // Size first, which costs nothing, then the limit, so a refused call costs nothing more.
    if (!fitsOneCall(data)) return { kind: "too-large" };
    const allowed = await limits.take(userId);
    if (allowed === "user-limit" || allowed === "global-limit") return { kind: "limit" };
    if (allowed === "unavailable") return { kind: "unavailable" };
    const built = buildPrompt({ instructions, data });
    if (built.kind === "too-large") return { kind: "too-large" };
    const answer = await model.ask({
      system: `${SYSTEM_RULES}\n\n${task}`,
      prompt: built.prompt,
      schema,
    });
    return answer.kind === "answer" ? answer : { kind: "unavailable" };
  },
});
