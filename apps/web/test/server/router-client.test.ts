import { describe, expect, it, vi } from "vitest";
import { PackageOperation } from "../../src/generated/operations.ts";
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
    ["a body of the wrong shape", { data: "text" }],
    ["no answer at all", undefined],
  ])("reports %s as no answer", async (_, answer) => {
    expect((await run(answer)).result).toEqual({ ok: false });
  });
});
