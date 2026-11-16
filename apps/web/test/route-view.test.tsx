import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RouteView } from "../src/operations/route-view.tsx";
import type { RouteStep } from "../src/route/types.ts";
import { expectNoAxeViolations } from "./axe.ts";

const step = (
  id: number,
  subgraph: string,
  stage: number,
  extra: Partial<RouteStep> = {},
): RouteStep => ({
  id,
  subgraph,
  kind: "entity",
  path: "package",
  after: [0],
  stage,
  query: `{ ${subgraph} }`,
  ...extra,
});

const PACKAGE = {
  steps: [
    step(0, "packages", 0, { kind: "root", path: null, after: [] }),
    step(1, "repositories", 1),
    step(2, "advisories", 1),
  ],
};

describe("RouteView", () => {
  it("[FR-WB-7] lists the subgraphs in fetch order, stage by stage", () => {
    render(<RouteView route={PACKAGE} />);

    expect(screen.getByText("3 requests to 3 subgraphs, in 2 stages.")).toBeTruthy();
    const [first, second] = screen.getAllByRole("heading", { level: 3 });
    expect(first?.textContent).toBe("Stage 1");
    expect(second?.textContent).toBe("Stage 2: 2 requests at the same time");
    const stages = screen.getAllByRole("list").filter((list) => list.tagName === "UL");
    expect(within(stages[0] as HTMLElement).getByText("packages")).toBeTruthy();
    expect(
      within(stages[1] as HTMLElement)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("strong")?.textContent),
    ).toEqual(["repositories", "advisories"]);
  });

  it("[FR-WB-7] says what each request is for, and what it waits on", () => {
    render(<RouteView route={PACKAGE} />);

    expect(screen.getByText("Starts the operation.")).toBeTruthy();
    expect(
      screen.getAllByText("Adds fields to package, using the answer from packages."),
    ).toHaveLength(2);
  });

  it("describes a request with no path, or one that waits on nothing it can name", () => {
    render(
      <RouteView
        route={{
          steps: [
            step(0, "a", 0, { path: null, after: [] }),
            step(1, "b", 1, { after: [9] }),
            step(2, "c", 2, { after: [0, 1] }),
          ],
        }}
      />,
    );

    expect(screen.getByText("Adds fields.")).toBeTruthy();
    expect(screen.getByText("Adds fields to package.")).toBeTruthy();
    expect(screen.getByText("Adds fields to package, using the answer from a and b.")).toBeTruthy();
  });

  it("[FR-WB-7] shows what the router asks each subgraph, as text", () => {
    render(
      <RouteView
        route={{ steps: [step(0, "packages", 0, { query: "<img src=x onerror=alert(1)>" })] }}
      />,
    );

    const request = screen.getByRole("region", { name: "The request to packages" });
    expect(request.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(request.querySelector("img")).toBeNull();
    expect(screen.getByText("1 request to 1 subgraph, in 1 stage.")).toBeTruthy();
  });

  it("draws the same route as a picture that assistive technology skips", () => {
    render(<RouteView route={PACKAGE} />);

    const outline = screen.getByTestId("route-outline");
    expect(outline.getAttribute("aria-hidden")).toBe("true");
    expect([...outline.querySelectorAll("text")].map((text) => text.textContent)).toEqual([
      "packages",
      "repositories",
      "advisories",
    ]);
    // One line for each "waits on": repositories and advisories both wait on packages.
    expect(outline.querySelectorAll("line")).toHaveLength(2);
    // Two stages side by side, and the second stage's two requests stacked.
    const [packages, repositories, advisories] = [...outline.querySelectorAll("rect")];
    expect(Number(repositories?.getAttribute("x"))).toBeGreaterThan(
      Number(packages?.getAttribute("x")),
    );
    expect(repositories?.getAttribute("x")).toBe(advisories?.getAttribute("x"));
    expect(Number(advisories?.getAttribute("y"))).toBeGreaterThan(
      Number(repositories?.getAttribute("y")),
    );
  });

  it("draws no line to a request the route doesn't hold", () => {
    render(<RouteView route={{ steps: [step(1, "b", 0, { after: [9] })] }} />);

    expect(screen.getByTestId("route-outline").querySelectorAll("line")).toHaveLength(0);
  });

  it("says so when an operation needs no subgraph", () => {
    render(<RouteView route={{ steps: [] }} />);

    expect(screen.getByText("This operation needs no subgraph.")).toBeTruthy();
  });

  it("[NFR-9] has no axe violations", async () => {
    const { container } = render(<RouteView route={PACKAGE} />);

    await expectNoAxeViolations(container);
  });
});
