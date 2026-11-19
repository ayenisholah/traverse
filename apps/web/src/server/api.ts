import { isPackageName, isVersion } from "@traverse/formats";
import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { z } from "zod";
import { PackageOperation, type PackageQuery } from "../generated/operations.ts";
import { advisoriesWithFixesSchema, repositorySchema } from "./answer-schemas.ts";
import { checkDependencies } from "./dependency-check.ts";
import { parseManifest } from "./manifest.ts";
import { loadPackagePage } from "./package-page.ts";
import { readCapped } from "./read-capped.ts";
import type { RouterClient } from "./router-client.ts";
import { subjectOf, type Assistant } from "./assistant/assistant.ts";
import { explain, explainInput } from "./assistant/explain.ts";
import { suggest, suggestInput } from "./assistant/suggest.ts";
import demoImpact from "../generated/demo-impact.json" with { type: "json" };
import type { SandboxClient } from "./sandbox-client.ts";
import {
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  saveInput,
  saveWorkspace,
  signedInToken,
  workspaceId,
} from "./workspaces.ts";

export interface Context {
  router: RouterClient;
  sandbox: SandboxClient;
  /** Whether the server has a user pool to sign in with. */
  canSignIn: boolean;
  /** The signed-in user's access token, read from their sealed cookies. It never leaves the server. */
  accessToken: string | undefined;
  /** The assistant, when the server has one (FR-AI-4). */
  assistant: Assistant | undefined;
}

const UNAVAILABLE = "The graph didn't answer";
const MESSAGES: Partial<Record<TRPCError["code"], string>> = {
  SERVICE_UNAVAILABLE: UNAVAILABLE,
  BAD_REQUEST: "Invalid input",
  NOT_FOUND: "Not found",
  UNAUTHORIZED: "Sign in first",
  PRECONDITION_FAILED: "Keep at most 50 workspaces. Delete one first.",
};

const t = initTRPC.context<Context>().create({
  // tRPC's own messages repeat the caller's path and parser errors, and an unexpected fault's
  // message could name internals. Only these fixed messages leave the server, with no stack.
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    message: MESSAGES[error.code] ?? "Something went wrong",
    data: { code: shape.data.code, httpStatus: shape.data.httpStatus },
  }),
});

const packageInput = z.object({
  name: z.string().refine(isPackageName),
  version: z.string().refine(isVersion).optional(),
});

// The generated type says what the operation asks for. This checks the router sent exactly that,
// so a field nobody selected, such as a maintainer's email, can't pass through (GR-16). The
// `satisfies` fails the build if the two drift apart.
const packageData = z.strictObject({
  package: z
    .strictObject({
      name: z.string(),
      latestVersion: z.string(),
      license: z.string().nullable(),
      weeklyDownloads: z.number().nullable(),
      repositoryUrl: z.string().nullable(),
      repository: repositorySchema,
      advisories: advisoriesWithFixesSchema,
    })
    .nullable(),
}) satisfies z.ZodType<PackageQuery>;

const MAX_OPERATION_LENGTH = 10_000;
const MAX_VARIABLES_LENGTH = 10_000;

const routeInput = z.object({
  operation: z.string().min(1).max(MAX_OPERATION_LENGTH),
  variables: z
    .record(z.string(), z.unknown())
    .refine((variables) => JSON.stringify(variables).length <= MAX_VARIABLES_LENGTH)
    .default({}),
});

const MAX_MANIFEST_LENGTH = 30_000;

const api = t.router({
  // Whether anyone is signed in, and nothing about who: the page needs no more to offer sign-in
  // or sign-out, and the token stays on the server (GR-9).
  viewer: t.procedure.query(({ ctx }) => ({
    canSignIn: ctx.canSignIn,
    signedIn: ctx.accessToken !== undefined,
    // Only a signed-in user may ask, so each call counts against someone (GR-15).
    canAsk: ctx.assistant !== undefined && ctx.accessToken !== undefined,
  })),
  packagePage: t.procedure
    .input(z.object({ name: z.string().refine(isPackageName) }))
    .query(({ ctx, input }) => loadPackagePage(ctx.router, input.name)),
  // A mutation only so the pasted text travels in a POST body, never in an address (GR-4).
  checkManifest: t.procedure
    .input(z.object({ manifest: z.string().min(1).max(MAX_MANIFEST_LENGTH) }))
    .mutation(({ ctx, input, signal }) => {
      const parsed = parseManifest(input.manifest);
      if (!parsed.ok) return { kind: "invalid" as const, message: parsed.message };
      return checkDependencies(ctx.router, parsed.entries, parsed.leftOut, { signal });
    }),

  // A mutation only so the operation travels in a POST body. A query would put it in the address,
  // where a proxy or a load balancer logs it (GR-4). It changes nothing.
  route: t.procedure
    .input(routeInput)
    .mutation(({ ctx, input }) => ctx.sandbox.route(input.operation, input.variables)),

  // A user's own workspaces, run on the router with their access token. The token never leaves
  // this server, and the subgraph takes the user from it, never from anything sent here (GR-3).
  workspaces: t.procedure.query(({ ctx }) =>
    listWorkspaces(ctx.router, signedInToken(ctx.accessToken)),
  ),
  workspace: t.procedure
    .input(workspaceId)
    .query(({ ctx, input }) => getWorkspace(ctx.router, signedInToken(ctx.accessToken), input.id)),
  saveWorkspace: t.procedure
    .input(saveInput)
    .mutation(({ ctx, input }) => saveWorkspace(ctx.router, signedInToken(ctx.accessToken), input)),
  deleteWorkspace: t.procedure
    .input(workspaceId)
    .mutation(({ ctx, input }) =>
      deleteWorkspace(ctx.router, signedInToken(ctx.accessToken), input.id),
    ),

  // A mutation, so the result travels in a POST body. Only a signed-in user may ask, and the
  // answer is shown only once it's checked against this result (GR-12, GR-15).
  explain: t.procedure.input(explainInput).mutation(async ({ ctx, input }) => {
    const userId = subjectOf(signedInToken(ctx.accessToken));
    if (userId === undefined) throw new TRPCError({ code: "UNAUTHORIZED" });
    if (ctx.assistant === undefined) return { kind: "unavailable" as const };
    return explain(ctx.assistant, userId, input);
  }),

  // The impact page checks drafts against the demo graph, so the server checks a suggestion
  // against its own copy of that graph, never one the browser sends (GR-12).
  suggest: t.procedure.input(suggestInput).mutation(async ({ ctx, input }) => {
    const userId = subjectOf(signedInToken(ctx.accessToken));
    if (userId === undefined) throw new TRPCError({ code: "UNAUTHORIZED" });
    if (ctx.assistant === undefined) return { kind: "unavailable" as const };
    return suggest(ctx.assistant, userId, demoImpact.subgraphs, input);
  }),

  package: t.procedure.input(packageInput).query(async ({ ctx, input }) => {
    const result = await ctx.router.run(PackageOperation, {
      name: input.name,
      version: input.version ?? null,
    });
    const data = result.ok ? packageData.safeParse(result.data) : undefined;
    if (!result.ok || !data?.success) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: UNAVAILABLE });
    }
    return { package: data.data.package, incomplete: result.incomplete };
  }),
});

/** What the browser's client may call, as a type only: none of this code reaches the browser. */
export type Api = typeof api;

// Far above the largest call the procedures accept, so only a request no browser would send fails.
const MAX_BODY_BYTES = 32_000;
// A saved workspace is the one large call: up to 210,000 characters, which UTF-8 and JSON escaping
// can grow several times. It matches the router's own limit, which the save must pass anyway.
const MAX_SAVE_BYTES = 1_000_000;
// A suggestion carries the user's drafts, and a draft of the largest demo schema is 26 KB.
const MAX_SUGGEST_BYTES = 256_000;
const LARGE_CALLS: Record<string, number> = {
  "/api/trpc/saveWorkspace": MAX_SAVE_BYTES,
  "/api/trpc/suggest": MAX_SUGGEST_BYTES,
};

const refused = (status: number, message: string, code: string): Response =>
  Response.json(
    { error: { message, data: { code, httpStatus: status } } },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );

const tooLarge = (): Response =>
  Response.json(
    {
      error: { message: "Request too large", data: { code: "PAYLOAD_TOO_LARGE", httpStatus: 413 } },
    },
    { status: 413, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );

/**
 * Answers a browser's call. The browser never talks to a router itself. tRPC reads a whole body
 * before checking it, so a body is read here first, and only up to a size no real call reaches.
 */
export const handleApiRequest = async (request: Request, context: Context): Promise<Response> => {
  // A browser marks a request another site started. Mutations change a user's data, so only this
  // app's own pages may send them (the session cookie is SameSite=Lax, which lets a POST form from
  // another site through).
  const site = request.headers.get("sec-fetch-site");
  if (request.method === "POST" && site !== null && site !== "same-origin") {
    return refused(403, "Forbidden", "FORBIDDEN");
  }
  let req = request;
  if (request.body !== null) {
    const path = new URL(request.url).pathname;
    const body = await readCapped(request.body, LARGE_CALLS[path] ?? MAX_BODY_BYTES);
    if (body === undefined) return tooLarge();
    req = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
      // So a procedure knows when the browser has gone, and can stop asking the sources.
      signal: request.signal,
    });
  }
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: api,
    createContext: () => context,
    allowBatching: false,
    // Live data, so nothing between the server and the browser keeps a copy, and the body is
    // only ever read as JSON.
    responseMeta: () => ({
      headers: new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff" }),
    }),
  });
};
