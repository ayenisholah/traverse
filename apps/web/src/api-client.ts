import { createTRPCClient, httpLink } from "@trpc/client";
// A type only: it's erased when the page is built, so no server code follows it to the browser.
import type { Api } from "./server/api.ts";

/** The browser's client for this app's own server. The browser never calls a router. */
export const createApiClient = (fetch?: typeof globalThis.fetch) =>
  createTRPCClient<Api>({ links: [httpLink({ url: "/api/trpc", ...(fetch && { fetch }) })] });
