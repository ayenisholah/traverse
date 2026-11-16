import { describe, expect, it } from "vitest";
import nameOnly from "../fixtures/sandbox-name-only.json" with { type: "json" };
import packagePlan from "../fixtures/sandbox-package.json" with { type: "json" };
import { toRoute } from "../../src/server/route-model.ts";

const fetchOf = (fetchId: number, subgraphName: string, extra: object = {}) => ({
  kind: "Single",
  fetch: { kind: "Entity", subgraphName, fetchId, query: "{ q }", ...extra },
});

describe("toRoute", () => {
  it("[FR-WB-7] reads the pinned router's plan for Package: packages first, then the other two together", () => {
    const route = toRoute(packagePlan.extensions.queryPlan);

    expect(
      route?.steps.map(({ id, subgraph, kind, path, after, stage }) => ({
        id,
        subgraph,
        kind,
        path,
        after,
        stage,
      })),
    ).toEqual([
      { id: 0, subgraph: "packages", kind: "root", path: null, after: [], stage: 0 },
      { id: 1, subgraph: "repositories", kind: "entity", path: "package", after: [0], stage: 1 },
      { id: 2, subgraph: "advisories", kind: "entity", path: "package", after: [0], stage: 1 },
    ]);
    expect(route?.steps[1]?.query).toContain("_entities(representations: $representations)");
  });

  it("[FR-WB-7] reads a plan that is one fetch", () => {
    expect(toRoute(nameOnly.extensions.queryPlan)?.steps).toEqual([
      expect.objectContaining({ id: 0, subgraph: "packages", kind: "root", stage: 0 }),
    ]);
  });

  it("[FR-WB-7] gives a step after a parallel group the stage after the group's longest branch", () => {
    const plan = {
      kind: "Sequence",
      children: [
        fetchOf(0, "a"),
        {
          kind: "Parallel",
          children: [
            { kind: "Sequence", children: [fetchOf(1, "b"), fetchOf(2, "c")] },
            fetchOf(3, "d"),
          ],
        },
        fetchOf(4, "e"),
      ],
    };

    expect(toRoute(plan)?.steps.map(({ subgraph, stage }) => [subgraph, stage])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 1],
      ["e", 3],
    ]);
  });

  it("reads a plan with nothing to fetch as a route with no steps", () => {
    expect(toRoute({ kind: "Parallel", children: [] })).toEqual({ steps: [] });
  });

  it.each([
    ["nothing", undefined],
    ["text", "Single"],
    ["a kind this code doesn't know", { kind: "Trigger", fetch: {} }],
    [
      "a fetch with no subgraph",
      { kind: "Single", fetch: { kind: "Single", fetchId: 0, query: "" } },
    ],
    ["a subgraph name too long to be one", fetchOf(0, "x".repeat(201))],
    ["a group whose child isn't a plan", { kind: "Sequence", children: [1] }],
  ])("returns nothing for %s", (_, plan) => {
    expect(toRoute(plan)).toBeUndefined();
  });
});
