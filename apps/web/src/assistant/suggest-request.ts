import { createApiClient } from "../api-client.ts";

type SuggestRequest = Parameters<ReturnType<typeof createApiClient>["suggest"]["mutate"]>[0];
export type SuggestAnswer = Awaited<
  ReturnType<ReturnType<typeof createApiClient>["suggest"]["mutate"]>
>;
export type Suggest = (request: SuggestRequest) => Promise<SuggestAnswer>;

// The server reads at most 256 KB of a suggestion.
const MAX_REQUEST_BYTES = 250_000;

/** Asks this app's server for a safer change. A call that fails reads as unavailable. */
export const createSuggest =
  (fetch?: typeof globalThis.fetch): Suggest =>
  (request) =>
    new TextEncoder().encode(JSON.stringify(request)).length > MAX_REQUEST_BYTES
      ? Promise.resolve({ kind: "too-large" })
      : createApiClient(fetch)
          .suggest.mutate(request)
          .catch((): SuggestAnswer => ({ kind: "unavailable" }));
