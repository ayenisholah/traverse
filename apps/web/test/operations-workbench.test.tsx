import { EditorView } from "@codemirror/view";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OperationsWorkbench } from "../src/operations/operations-workbench.tsx";
import type { FetchRoute } from "../src/operations/route-client.ts";
import type { RouteAnswer } from "../src/route/types.ts";
import { expectNoAxeViolations } from "./axe.ts";

const SCHEMA = "type Package { name: String } type Query { package(name: String!): Package }";
const SEED = "query Example($name: String!) { package(name: $name) { name } }";
const ROUTE: RouteAnswer = {
  kind: "route",
  route: {
    steps: [
      {
        id: 0,
        subgraph: "packages",
        kind: "root",
        path: null,
        after: [],
        stage: 0,
        query: "{ q }",
      },
    ],
  },
};

const setup = (fetchRoute: FetchRoute = vi.fn(async () => ROUTE)) => {
  const rendered = render(
    <OperationsWorkbench
      schemaSdl={SCHEMA}
      seedOperation={SEED}
      seedVariables={'{ "name": "express" }'}
      fetchRoute={fetchRoute}
    />,
  );
  return { fetchRoute, user: userEvent.setup(), ...rendered };
};

const type = (text: string) => {
  const view = EditorView.findFromDOM(screen.getByRole("textbox", { name: "Operation" }));
  view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
};

const run = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Show route" }));

describe("OperationsWorkbench", () => {
  it("starts with an example and a hint, and has run nothing", () => {
    const { fetchRoute } = setup();

    expect(screen.getByText("Run an operation to see which subgraphs answer it.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Operation" }).textContent).toContain("Example");
    expect(fetchRoute).not.toHaveBeenCalled();
  });

  it("[FR-WB-7] sends the operation and its variables, and shows the route that comes back", async () => {
    const { fetchRoute, user } = setup();

    await run(user);

    expect(fetchRoute).toHaveBeenCalledWith(SEED, { name: "express" });
    expect(await screen.findByText("1 request to 1 subgraph, in 1 stage.")).toBeTruthy();
  });

  it("[FR-WB-7] sends what was typed, not the example", async () => {
    const { fetchRoute, user } = setup();

    type('query Mine { package(name: "ms") { name } }');
    await user.clear(screen.getByRole("textbox", { name: /Variables/ }));
    await run(user);

    expect(fetchRoute).toHaveBeenCalledWith('query Mine { package(name: "ms") { name } }', {});
  });

  it("says it's working while the route is on its way", async () => {
    let finish: (answer: RouteAnswer) => void = () => undefined;
    const { user } = setup(() => new Promise((resolve) => (finish = resolve)));

    await run(user);

    expect(screen.getByRole("status").textContent).toBe("Finding the route…");
    finish(ROUTE);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("shows why the router refused an operation, as text", async () => {
    const messages = ['Cannot query field "nope" on type "Package".', "<b>second</b>"];
    const { user, container } = setup(vi.fn(async () => ({ kind: "refused" as const, messages })));

    await run(user);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The router refused this operation:");
    expect(alert.textContent).toContain('Cannot query field "nope" on type "Package".');
    expect(alert.textContent).toContain("<b>second</b>");
    expect(container.querySelector("b")).toBeNull();
  });

  it("says so when the route can't be worked out", async () => {
    const { user } = setup(vi.fn(async () => ({ kind: "unavailable" as const })));

    await run(user);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "The route couldn't be worked out just now. Try again.",
    );
  });

  it.each(["{ not json", "[1, 2]", '"text"', "null"])(
    "asks for a JSON object when the variables are %s, and runs nothing",
    async (text) => {
      const { fetchRoute, user } = setup();
      const variables = screen.getByRole("textbox", { name: /Variables/ });

      await user.clear(variables);
      await user.click(variables);
      await user.paste(text);
      await run(user);

      expect(screen.getByRole("alert").textContent).toContain(
        "The variables must be a JSON object",
      );
      expect(fetchRoute).not.toHaveBeenCalled();
    },
  );

  it("can't run an empty operation", () => {
    setup();

    type("   ");

    return waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Show route" }).disabled).toBe(
        true,
      ),
    );
  });

  it("shows only the latest run's answer when an earlier one arrives late", async () => {
    const finish: ((answer: RouteAnswer) => void)[] = [];
    const { user } = setup(() => new Promise((resolve) => finish.push(resolve)));

    await run(user);
    await run(user);
    finish[1]?.({ kind: "refused", messages: ["the second answer"] });
    await screen.findByText("the second answer");
    finish[0]?.(ROUTE);
    await Promise.resolve();

    expect(screen.getByText("the second answer")).toBeTruthy();
    expect(screen.queryByText("1 request to 1 subgraph, in 1 stage.")).toBeNull();
  });

  it("drops a late answer once the variables have been found wrong", async () => {
    let finish: (answer: RouteAnswer) => void = () => undefined;
    const { user } = setup(() => new Promise((resolve) => (finish = resolve)));
    const variables = screen.getByRole("textbox", { name: /Variables/ });

    await run(user);
    await user.clear(variables);
    await user.click(variables);
    await user.paste("nope");
    await run(user);
    finish(ROUTE);
    await Promise.resolve();

    expect(screen.getByRole("alert").textContent).toContain("The variables must be a JSON object");
  });

  it("[NFR-9] has no axe violations, with a route showing", async () => {
    const { user, container } = setup();

    await run(user);
    await screen.findByText("1 request to 1 subgraph, in 1 stage.");

    await expectNoAxeViolations(container);
  });
});
