import { z } from "zod";
import type { Route, RouteStep } from "../route/types.ts";

// The plan's shape on the pinned router (C-37, C-56). Only the fields the route shows are read.
const fetchSchema = z.object({
  kind: z.string(),
  subgraphName: z.string().max(200),
  fetchId: z.number().int(),
  path: z.string().max(500).optional(),
  dependsOnFetchIds: z.array(z.number().int()).max(100).optional(),
  query: z.string().max(20_000),
});

type PlanNode =
  | { kind: "Single"; fetch: z.infer<typeof fetchSchema> }
  | { kind: "Sequence" | "Parallel"; children: PlanNode[] };

const nodeSchema: z.ZodType<PlanNode> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("Single"), fetch: fetchSchema }),
    z.object({ kind: z.enum(["Sequence", "Parallel"]), children: z.array(nodeSchema).max(100) }),
  ]),
);

// Walks the tree in the router's order. A sequence's children take one stage after another, and
// a parallel group's children all start in the same one. Returns the first stage left free.
const walk = (node: PlanNode, stage: number, steps: RouteStep[]): number => {
  if (node.kind === "Single") {
    const { fetch } = node;
    steps.push({
      id: fetch.fetchId,
      subgraph: fetch.subgraphName,
      kind: fetch.kind === "Single" ? "root" : "entity",
      path: fetch.path ?? null,
      after: fetch.dependsOnFetchIds ?? [],
      stage,
      query: fetch.query,
    });
    return stage + 1;
  }
  if (node.kind === "Sequence") {
    return node.children.reduce((next, child) => walk(child, next, steps), stage);
  }
  return Math.max(stage, ...node.children.map((child) => walk(child, stage, steps)));
};

/** The route a query plan describes, or nothing if it isn't a plan this code understands. */
export const toRoute = (plan: unknown): Route | undefined => {
  const parsed = nodeSchema.safeParse(plan);
  if (!parsed.success) return undefined;
  const steps: RouteStep[] = [];
  walk(parsed.data, 0, steps);
  return { steps };
};
