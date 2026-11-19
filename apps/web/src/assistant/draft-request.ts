import { createApiClient } from "../api-client.ts";

export type DraftAnswer = Awaited<
  ReturnType<ReturnType<typeof createApiClient>["draft"]["mutate"]>
>;
export type Draft = (description: string) => Promise<DraftAnswer>;

/** Asks this app's server to draft an operation. A call that fails reads as unavailable. */
export const createDraft =
  (fetch?: typeof globalThis.fetch): Draft =>
  (description) =>
    createApiClient(fetch)
      .draft.mutate({ description })
      .catch((): DraftAnswer => ({ kind: "unavailable" }));
