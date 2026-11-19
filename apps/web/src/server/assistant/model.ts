import type { z } from "zod";

/** Why there's no answer. Fixed codes: nothing the model or the service said is kept. */
export type Unavailable = "throttled" | "timeout" | "refused" | "invalid" | "error";

export type ModelAnswer<T> =
  { kind: "answer"; value: T } | { kind: "unavailable"; reason: Unavailable };

interface ModelRequest<T> {
  /** What the model is told it is doing. Fixed per task, never user text. */
  system: string;
  /** The instructions and the data blocks from `buildPrompt`. */
  prompt: string;
  /** The only shape an answer may take. Anything else is `invalid` (GR-12). */
  schema: z.ZodType<T>;
  /** The most the answer may run to, when a task needs more than the usual. */
  maxTokens?: number;
}

/**
 * The assistant's one way to reach a model. A caller gets a value that parsed against its schema,
 * or a reason it didn't, and never the model's own text.
 */
export interface Model {
  ask: <T>(request: ModelRequest<T>) => Promise<ModelAnswer<T>>;
}
