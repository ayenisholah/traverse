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
import type { SandboxClient } from "./sandbox-client.ts";

export interface Context {
  router: RouterClient;
  sandbox: SandboxClient;
}

const UNAVAILABLE = "The graph didn't answer";
const MESSAGES: Partial<Record<TRPCError["code"], string>> = {
  SERVICE_UNAVAILABLE: UNAVAILABLE,
  BAD_REQUEST: "Invalid input",
  NOT_FOUND: "Not found",
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
  packagePage: t.procedure
    .input(z.object({ name: z.string().refine(isPackageName) }))
    .query(({ ctx, input }) => loadPackagePage(ctx.router, input.name)),
  // A mutation only so the pasted text travels in a POST body, never in an address (GR-4).
  checkManifest: t.procedure
    .input(z.object({ manifest: z.string().min(1).max(MAX_MANIFEST_LENGTH) }))
    .mutation(({ ctx, input }) => {
      const parsed = parseManifest(input.manifest);
      if (!parsed.ok) return { kind: "invalid" as const, message: parsed.message };
      return checkDependencies(ctx.router, parsed.entries, parsed.leftOut);
    }),

  // A mutation only so the operation travels in a POST body. A query would put it in the address,
  // where a proxy or a load balancer logs it (GR-4). It changes nothing.
  route: t.procedure
    .input(routeInput)
    .mutation(({ ctx, input }) => ctx.sandbox.route(input.operation, input.variables)),

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
  let req = request;
  if (request.body !== null) {
    const body = await readCapped(request.body, MAX_BODY_BYTES);
    if (body === undefined) return tooLarge();
    req = new Request(request.url, { method: request.method, headers: request.headers, body });
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
