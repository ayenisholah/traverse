import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateTypedOperations, operationHash, persistedOperation } from "../src/index.ts";

const SCHEMA = `
  type Package { name: String! license: String }
  type Query { package(name: String!): Package }
  type Mutation { star(name: String!): Boolean }
`;
const PACKAGE = `query Package($name: String!) {\n  package(name: $name) {\n    license\n  }\n}\n`;
const STAR = `mutation Star($name: String!) { star(name: $name) }`;

describe("operationHash", () => {
  it("[FR-WB-12] is the SHA-256 of the document's exact bytes, as the router computes it", () => {
    expect(operationHash(PACKAGE)).toBe(createHash("sha256").update(PACKAGE).digest("hex"));
    expect(operationHash(`${PACKAGE} `)).not.toBe(operationHash(PACKAGE));
  });
});

describe("persistedOperation", () => {
  it("[GR-2] writes the file the router's file provider reads", () => {
    expect(persistedOperation(PACKAGE)).toEqual({
      file: `${operationHash(PACKAGE)}.json`,
      content: `${JSON.stringify({ version: 1, body: PACKAGE })}\n`,
    });
  });
});

describe("generateTypedOperations", () => {
  it("[FR-WB-12] types each operation's variables and data, and names it by its hash", async () => {
    const source = await generateTypedOperations(SCHEMA, [
      { file: "package.graphql", body: PACKAGE },
      { file: "star.graphql", body: STAR },
    ]);

    expect(source).toContain("export type PackageQueryVariables = Exact<{\n  name: string;\n}>;");
    expect(source).toContain(
      "export type PackageQuery = { package: { license: string | null } | null };",
    );
    expect(source).toContain(
      `export const PackageOperation: TypedOperation<PackageQuery, PackageQueryVariables> = {\n  name: "Package",\n  sha256: "${operationHash(PACKAGE)}",\n};`,
    );
    expect(source).toContain(
      "export const StarOperation: TypedOperation<StarMutation, StarMutationVariables> = {",
    );
  });

  it("[FR-WB-12] holds no operation text, so the app can only send a hash", async () => {
    const source = await generateTypedOperations(SCHEMA, [
      { file: "package.graphql", body: PACKAGE },
    ]);

    expect(source).not.toContain("package(name:");
  });

  it("[FR-WB-12] fails when a document asks for a field the schema doesn't have", async () => {
    const mismatch = `query Package { package(name: "x") { stars } }`;

    await expect(
      generateTypedOperations(SCHEMA, [{ file: "package.graphql", body: mismatch }]),
    ).rejects.toThrow('Cannot query field "stars" on type "Package"');
  });

  it.each([
    ["an anonymous operation", `{ package(name: "x") { name } }`],
    ["two operations", `query A { package(name: "x") { name } } query B { __typename }`],
    ["a fragment alone", `fragment F on Package { name }`],
    ["nothing but a comment", `# empty`],
  ])("refuses a file holding %s", async (_, body) => {
    await expect(generateTypedOperations(SCHEMA, [{ file: "bad.graphql", body }])).rejects.toThrow(
      /bad\.graphql must hold exactly one named operation|Syntax Error/,
    );
  });

  it("refuses two files that name the same operation, because one constant would hide the other", async () => {
    await expect(
      generateTypedOperations(SCHEMA, [
        { file: "a.graphql", body: PACKAGE },
        { file: "b.graphql", body: `${PACKAGE}\n` },
      ]),
    ).rejects.toThrow("Two operations are named Package");
  });
});
