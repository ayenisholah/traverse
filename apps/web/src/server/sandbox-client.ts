import { z } from "zod";
import type { RouteAnswer } from "../route/types.ts";
import type { PostGraphql } from "./post-graphql.ts";
import { toRoute } from "./route-model.ts";

const MAX_MESSAGES = 5;
const MAX_MESSAGE_LENGTH = 300;

const responseSchema = z.object({
  errors: z.array(z.object({ message: z.string() })).optional(),
  extensions: z.object({ queryPlan: z.unknown() }).optional(),
});

export interface SandboxClient {
  route: (operation: string, variables: Record<string, unknown>) => Promise<RouteAnswer>;
}

/**
 * Asks the sandbox router to run a free-form operation, and keeps only its route. The data the
 * operation returns is dropped here: nothing checks a free-form answer's shape, so none of it goes
 * to the browser (GR-16).
 *
 * An answer with no plan is the router refusing the operation before running it: a syntax error,
 * a field the schema doesn't have, a mutation, or a limit. Those messages describe the caller's
 * own operation, so they're passed on, cut short. Once there's a plan, error messages can carry a
 * subgraph's text, and none of them is passed on.
 */
export const createSandboxClient = (post: PostGraphql): SandboxClient => ({
  route: async (operation, variables) => {
    const body = responseSchema.safeParse(await post({ query: operation, variables }));
    if (!body.success) return { kind: "unavailable" };
    const plan = body.data.extensions?.queryPlan;
    const messages = (body.data.errors ?? [])
      .slice(0, MAX_MESSAGES)
      .map(({ message }) => message.slice(0, MAX_MESSAGE_LENGTH));
    if (plan === undefined) {
      return messages.length > 0 ? { kind: "refused", messages } : { kind: "unavailable" };
    }
    const route = toRoute(plan);
    return route === undefined ? { kind: "unavailable" } : { kind: "route", route };
  },
});
