import { createTRPCClient, httpLink } from "@trpc/client";
import type { RouteAnswer } from "../route/types.ts";
// A type only: it's erased when the page is built, so no server code follows it to the browser.
import type { Api } from "../server/api.ts";

export type FetchRoute = (
  operation: string,
  variables: Record<string, unknown>,
) => Promise<RouteAnswer>;

/** Asks this app's own server for an operation's route. The browser never calls a router. */
export const createFetchRoute = (fetch?: typeof globalThis.fetch): FetchRoute => {
  const client = createTRPCClient<Api>({
    links: [httpLink({ url: "/api/trpc", ...(fetch && { fetch }) })],
  });
  return (operation, variables) =>
    client.route
      .mutate({ operation, variables })
      .catch((): RouteAnswer => ({ kind: "unavailable" }));
};
