import { isPackageName, isVersion } from "@traverse/formats";
import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { z } from "zod";
import { PackageOperation, type PackageQuery } from "../generated/operations.ts";
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
      repository: z
        .strictObject({
          url: z.string(),
          stars: z.number(),
          owner: z.string(),
          latestRelease: z.string().nullable(),
        })
        .nullable(),
      advisories: z
        .array(
          z.strictObject({
            id: z.string(),
            summary: z.string(),
            severity: z.string().nullable(),
            fixedIn: z.string().nullable(),
          }),
        )
        .nullable(),
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

const api = t.router({
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

/** Answers a browser's call. The browser never talks to a router itself. */
export const handleApiRequest = (request: Request, context: Context): Promise<Response> =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: api,
    createContext: () => context,
    allowBatching: false,
    // Live data, so nothing between the server and the browser keeps a copy, and the body is
    // only ever read as JSON.
    responseMeta: () => ({
      headers: new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff" }),
    }),
  });
