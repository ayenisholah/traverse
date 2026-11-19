import type { SchemaChangeFailure, SchemaChangeReport } from "@traverse/graph-core";
import { createApiClient } from "../api-client.ts";

// The server reads at most 32 KB of a call. A long list of errors is cut to fit, and anything else
// too large is said to be, rather than sent and refused.
const MAX_REQUEST_BYTES = 28_000;
const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const MAX_ERROR_LENGTH = 2_000;

type ExplainRequest = Parameters<ReturnType<typeof createApiClient>["explain"]["mutate"]>[0];
export type ExplainAnswer = Awaited<
  ReturnType<ReturnType<typeof createApiClient>["explain"]["mutate"]>
>;
export type Explain = (request: ExplainRequest) => Promise<ExplainAnswer>;

/** What the impact check found, as the server's `explain` takes it. Nothing else is sent. */
export const toExplainRequest = (
  report: SchemaChangeReport | SchemaChangeFailure,
): ExplainRequest | undefined => {
  if (!report.success) {
    const errors: string[] = [];
    for (const error of report.errors.slice(0, 30)) {
      const next = error.slice(0, MAX_ERROR_LENGTH);
      if (bytesOf([...errors, next]) > MAX_REQUEST_BYTES) break;
      errors.push(next);
    }
    return errors.length === 0 ? undefined : { kind: "composition", failed: report.failed, errors };
  }
  if (report.changes.length === 0 && report.operations.length === 0) return undefined;
  return {
    kind: "impact",
    changes: report.changes.slice(0, 100).map(({ coordinate, kind, subgraphs }) => ({
      coordinate,
      kind,
      subgraphs: subgraphs.slice(0, 10).map(({ name }) => name),
    })),
    operations: report.operations.slice(0, 50).map(({ name, fields, errors }) => ({
      name,
      fields: fields.slice(0, 100),
      errors: errors.slice(0, 20).map((error) => error.slice(0, MAX_ERROR_LENGTH)),
    })),
    screens: report.screens.slice(0, 50),
  };
};

/** Asks this app's server to explain a result. A call that fails reads as unavailable. */
export const createExplain =
  (fetch?: typeof globalThis.fetch): Explain =>
  (request) =>
    bytesOf(request) > MAX_REQUEST_BYTES
      ? Promise.resolve({ kind: "too-large" })
      : createApiClient(fetch)
          .explain.mutate(request)
          .catch((): ExplainAnswer => ({ kind: "unavailable" }));
