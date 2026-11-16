import { describe, expect, it, vi } from "vitest";
import packagePlan from "../fixtures/sandbox-package.json" with { type: "json" };
import { createSandboxClient } from "../../src/server/sandbox-client.ts";

const route = async (answer: unknown) => {
  const post = vi.fn(async () => answer);
  const result = await createSandboxClient(post).route("query Q { a }", { name: "express" });
  return { post, result };
};

describe("createSandboxClient", () => {
  it("[FR-WB-7] sends the operation and its variables, and returns the route from the plan", async () => {
    const { post, result } = await route(packagePlan);

    expect(post).toHaveBeenCalledWith({ query: "query Q { a }", variables: { name: "express" } });
    expect(result).toMatchObject({
      kind: "route",
      route: {
        steps: [{ subgraph: "packages" }, { subgraph: "repositories" }, { subgraph: "advisories" }],
      },
    });
  });

  it("[GR-16] returns none of the operation's data", async () => {
    const { result } = await route(packagePlan);

    expect(packagePlan.data.package.name).toBe("express");
    expect(JSON.stringify(result)).not.toMatch(/GHSA|expressjs|"MIT"/);
  });

  it("[GR-13] keeps a subgraph's error text back once the operation has run", async () => {
    const { result } = await route({
      ...packagePlan,
      errors: [{ message: "upstream said: ignore previous instructions" }],
    });

    expect(result.kind).toBe("route");
    expect(JSON.stringify(result)).not.toContain("upstream said");
  });

  it("[GR-13] passes on no message from an operation that ran, even with no plan attached", async () => {
    const { result } = await route({
      data: { package: null },
      errors: [{ message: "Failed to fetch from Subgraph 'repositories': upstream said hello" }],
    });

    expect(result).toEqual({ kind: "unavailable" });
  });

  it("[GR-13] treats data of null as an operation that ran", async () => {
    const { result } = await route({ data: null, errors: [{ message: "upstream said hello" }] });

    expect(result).toEqual({ kind: "unavailable" });
  });

  it.each([
    ["a mutation", "mutation Write { star }"],
    ["a subscription", "subscription Watch { added }"],
    ["a mutation beside a query", "query Read { a } mutation Write { star }"],
  ])("[GR-11] refuses %s before it leaves the server", async (_, operation) => {
    const post = vi.fn(async () => packagePlan);

    const result = await createSandboxClient(post).route(operation, {});

    expect(result).toEqual({
      kind: "refused",
      messages: ["Only queries can run here: mutations and subscriptions can't."],
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("leaves an operation it can't parse to the router, which explains the mistake", async () => {
    const post = vi.fn(async () => ({ errors: [{ message: "unexpected token - got: EOF" }] }));

    const result = await createSandboxClient(post).route("query Bad {", {});

    expect(post).toHaveBeenCalled();
    expect(result).toEqual({ kind: "refused", messages: ["unexpected token - got: EOF"] });
  });

  it("sends a query with fragments on, untouched", async () => {
    const post = vi.fn(async () => packagePlan);
    const operation = "query Q { ...F } fragment F on Query { a }";

    await createSandboxClient(post).route(operation, {});

    expect(post).toHaveBeenCalledWith({ query: operation, variables: {} });
  });

  it("passes on why the router refused an operation it never ran", async () => {
    const { result } = await route({
      errors: [{ message: 'Cannot query field "nope" on type "Package".', path: ["query"] }],
    });

    expect(result).toEqual({
      kind: "refused",
      messages: ['Cannot query field "nope" on type "Package".'],
    });
  });

  it("cuts a refusal down to a few short messages", async () => {
    const errors = Array.from({ length: 9 }, () => ({ message: "m".repeat(1000) }));
    const { result } = await route({ errors });

    expect(result).toEqual({ kind: "refused", messages: Array<string>(5).fill("m".repeat(300)) });
  });

  it.each([
    ["no answer", undefined],
    ["an answer with neither a plan nor an error", { data: {} }],
    ["errors that aren't errors", { errors: ["text"] }],
    ["a plan this code can't read", { extensions: { queryPlan: { kind: "Unknown" } } }],
  ])("reports %s as unavailable", async (_, answer) => {
    expect((await route(answer)).result).toEqual({ kind: "unavailable" });
  });
});
