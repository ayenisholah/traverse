import { isPackageName, isVersion } from "@traverse/formats";
import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { z } from "zod";
import { PackageOperation } from "../generated/operations.ts";
import type { RouterClient } from "./router-client.ts";

interface Context {
  router: RouterClient;
}

const t = initTRPC.context<Context>().create({
  // An unexpected fault's message and stack could name internals, so neither leaves the server.
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    message: error.code === "INTERNAL_SERVER_ERROR" ? "Something went wrong" : shape.message,
    data: { code: shape.data.code, httpStatus: shape.data.httpStatus },
  }),
});

const packageInput = z.object({
  name: z.string().refine(isPackageName),
  version: z.string().refine(isVersion).optional(),
});

const api = t.router({
  package: t.procedure.input(packageInput).query(async ({ ctx, input }) => {
    const result = await ctx.router.run(PackageOperation, {
      name: input.name,
      version: input.version ?? null,
    });
    if (!result.ok) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "The graph didn't answer" });
    }
    return { package: result.data.package, incomplete: result.incomplete };
  }),
});

/** Answers a browser's call. The browser never talks to a router itself. */
export const handleApiRequest = (request: Request, router: RouterClient): Promise<Response> =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: api,
    createContext: () => ({ router }),
    allowBatching: false,
  });
