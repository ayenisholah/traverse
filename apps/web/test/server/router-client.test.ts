import { describe, expect, it, vi } from "vitest";
import { PackageOperation } from "../../src/generated/operations.ts";
import type { PostGraphql } from "../../src/server/post-graphql.ts";
import { createRouterClient } from "../../src/server/router-client.ts";

const run = async (answer: unknown) => {
  const post = vi.fn(async () => answer);
  const result = await createRouterClient(post).run(PackageOperation, {
    name: "express",
    version: null,
  });
  return { post, result };
};

describe("createRouterClient", () => {
  it("[FR-WB-12] sends the generated operation's hash and never its text", async () => {
    const { post } = await run({ data: { package: null } });

    expect(post).toHaveBeenCalledWith({
      variables: { name: "express", version: null },
      extensions: { persistedQuery: { version: 1, sha256Hash: PackageOperation.sha256 } },
    });
  });

  it("returns the router's data", async () => {
    const data = { package: { name: "express" } };

    expect((await run({ data })).result).toEqual({ ok: true, data, incomplete: false });
  });

  it("[FR-SG-6] marks an answer incomplete when a subgraph failed, and keeps the error text back", async () => {
    const data = { package: { name: "express", repository: null } };
    const { result } = await run({ data, errors: [{ message: "upstream said: <script>" }] });

    expect(result).toEqual({ ok: true, data, incomplete: true });
    expect(JSON.stringify(result)).not.toContain("upstream said");
  });

  it.each([
    ["errors and no data", { errors: [{ message: "PersistedQueryNotFound" }] }],
    ["null data", { data: null, errors: [{ message: "failed" }] }],
    ["null data and no errors", { data: null }],
    ["a body of the wrong shape", { data: "text" }],
    ["no answer at all", undefined],
  ])("reports %s as no answer", async (_, answer) => {
    expect((await run(answer)).result).toEqual({ ok: false });
  });

  it("[GR-3] sends the user's access token only when given one", async () => {
    const post = vi.fn<PostGraphql>(async () => ({ data: { package: null } }));
    const client = createRouterClient(post);
    await client.run(PackageOperation, { name: "express", version: null });
    await client.run(PackageOperation, { name: "express", version: null }, "token-1");

    expect(post.mock.calls[0]).toHaveLength(1);
    expect(post.mock.calls[1]?.[1]).toEqual({ authorization: "Bearer token-1" });
  });

  it("[FR-WB-11] reads the codes of a subgraph's errors the router wrapped, and never their text", async () => {
    const { result } = await run({
      data: null,
      errors: [
        {
          message: "Failed to fetch from Subgraph 'workspace'.",
          extensions: {
            errors: [
              { message: "Sign in first.", extensions: { code: "UNAUTHENTICATED" } },
              { message: "x", extensions: { code: "not a code <script>" } },
            ],
          },
        },
        { message: "PersistedQueryNotFound", extensions: { code: "PERSISTED_QUERY_NOT_FOUND" } },
        null,
      ],
    });

    expect(result).toEqual({ ok: false, codes: ["UNAUTHENTICATED", "PERSISTED_QUERY_NOT_FOUND"] });
  });

  it("[GR-3] keeps the codes beside a partial answer", async () => {
    const { result } = await run({
      data: { workspace: null },
      errors: [
        {
          message: "x",
          extensions: { errors: [{ message: "y", extensions: { code: "UNAUTHENTICATED" } }] },
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      data: { workspace: null },
      incomplete: true,
      codes: ["UNAUTHENTICATED"],
    });
  });
});
