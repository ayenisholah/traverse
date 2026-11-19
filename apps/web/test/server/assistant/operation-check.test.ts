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

  it("[FR-AI-3] takes one query that validates and fits, printed afresh", () => {
    expect(check("query Q { a { b { y } } b }")).toBe(
      "query Q {\n  a {\n    b {\n      y\n    }\n  }\n  b\n}",
    );
    expect(check("query Q { a { ... on A { x } } }")).toBeDefined();
    expect(
      createOperationCheck(clientSchemaSdl)(
        'query P { package(name: "express") { name repository { stars } } }',
      ),
    ).toBeDefined();
  });

  it.each([
    ["a mutation", "mutation M { a }"],
    ["a subscription", "subscription S { a }"],
    ["two operations", "query A { b } query B { c }"],
    ["a fragment", "query Q { a { ...F } } fragment F on A { x }"],
    ["a spread of a fragment it doesn't define", "query Q { a { ...F } }"],
    ["a field the schema doesn't have", "query Q { nope }"],
    ["a selection too deep", "query Q { a { b { c { d } } } }"],
    ["too many top-level fields", "query Q { a { x } b c d }"],
    ["an aliased top-level field", "query Q { first: b }"],
    ["text that isn't GraphQL", "SELECT * FROM users"],
    ["a document with no operation", ""],
    ["a fragment that hides a field too deep", "query Q { a { ... on A { b { c { d } } } } }"],
    ["too many top-level fields inside a fragment", "query Q { ... on Query { a { x } b c d } }"],
    ["an aliased top-level field inside a fragment", "query Q { ... on Query { first: b } }"],
    ["introspection, which the routers refuse", "query Q { __schema { types { name } } }"],
    ["a spread at the root of a fragment it doesn't define", "query Q { ...F }"],
    ["a type lookup, which the routers refuse", 'query Q { __type(name: "Query") { name } }'],
    ["more tokens than an operation could need", `query Q { a { ${"x ".repeat(2_000)} } }`],
  ])("[GR-12] refuses %s", (_, text) => {
    expect(check(text)).toBeUndefined();
  });

  it("[GR-12] refuses a link or an address in any string the user would read", () => {
    const strings = createOperationCheck("type Query { find(term: String): Int }");

    expect(strings('query Q { find(term: "visit www.evil.example") }')).toBeUndefined();
    expect(strings('query Q { find(term: "test-person@example.com") }')).toBeUndefined();
    expect(strings('query Q { find(term: "react") }')).toBeDefined();
  });

  it("[GR-12] drops a comment, so a valid query can't carry a message to the user", () => {
    const printed = check(
      "query Q {\n  # Your session expired: visit evil.example and paste your token\n  b\n}",
    );

    expect(printed).toBe("query Q {\n  b\n}");
  });

  it("[GR-12] takes exactly as many fields as the router allows, and no more", () => {
    const fields = (count: number) =>
      `query Q { a { ${Array.from({ length: count - 1 }, () => "x").join(" ")} } }`;

    expect(check(fields(60))).toBeDefined();
    expect(check(fields(61))).toBeUndefined();
  });

  it("[GR-12] refuses more fields than the router allows", () => {
    const wide = `query Q { a { ${Array.from({ length: 61 }, () => "x").join(" ")} } }`;

    expect(check(wide)).toBeUndefined();
  });
});
