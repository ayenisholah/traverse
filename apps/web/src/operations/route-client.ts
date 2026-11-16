import { createApiClient } from "../api-client.ts";
import type { RouteAnswer } from "../route/types.ts";

export type FetchRoute = (
  operation: string,
  variables: Record<string, unknown>,
) => Promise<RouteAnswer>;

/** Asks this app's own server for an operation's route. */
export const createFetchRoute = (fetch?: typeof globalThis.fetch): FetchRoute => {
  const client = createApiClient(fetch);
  return (operation, variables) =>
    client.route
      .mutate({ operation, variables })
      .catch((): RouteAnswer => ({ kind: "unavailable" }));
};
