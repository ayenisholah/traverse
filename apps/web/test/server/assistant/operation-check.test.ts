import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { clientSchemaSdl } from "../../../src/generated/schema.ts";
import {
  createOperationCheck,
  ROUTER_LIMITS,
} from "../../../src/server/assistant/operation-check.ts";

const deep =
  "type Query { a: A b: Int c: Int d: Int }\ntype A { b: B x: Int } type B { c: C y: Int } type C { d: Int }";
const check = createOperationCheck(deep);

describe("createOperationCheck", () => {
  it("[GR-12] holds a draft to the routers' own limits", () => {
    const config = parseYaml(
      readFileSync(join(import.meta.dirname, "../../../../../router/config.yaml"), "utf8"),
    ) as { security: { complexity_limits: Record<string, { limit: number }> } };
    const limits = config.security.complexity_limits;

    expect(ROUTER_LIMITS).toEqual({
      depth: limits.depth?.limit,
      totalFields: limits.total_fields?.limit,
      rootFields: limits.root_fields?.limit,
      rootFieldAliases: limits.root_field_aliases?.limit,
    });
  });

  it("[FR-AI-3] takes one query that validates and fits", () => {
    expect(check("query Q { a { b { y } } b }")).toBe(true);
    expect(check("query Q { a { ... on A { x } } }")).toBe(true);
    expect(
      createOperationCheck(clientSchemaSdl)(
        'query P { package(name: "express") { name repository { stars } } }',
      ),
    ).toBe(true);
  });

  it.each([
    ["a mutation", "mutation M { a }"],
    ["a subscription", "subscription S { a }"],
    ["two operations", "query A { b } query B { c }"],
    ["a fragment", "query Q { a { ...F } } fragment F on A { x }"],
    ["a field the schema doesn't have", "query Q { nope }"],
    ["a selection too deep", "query Q { a { b { c { d } } } }"],
    ["too many top-level fields", "query Q { a { x } b c d }"],
    ["an aliased top-level field", "query Q { first: b }"],
    ["text that isn't GraphQL", "SELECT * FROM users"],
    ["a document with no operation", ""],
  ])("[GR-12] refuses %s", (_, text) => {
    expect(check(text)).toBe(false);
  });

  it("[GR-12] refuses more fields than the router allows", () => {
    const wide = `query Q { a { ${Array.from({ length: 61 }, () => "x").join(" ")} } }`;

    expect(check(wide)).toBe(false);
  });
});
