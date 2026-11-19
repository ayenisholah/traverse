import { describe, expect, it, vi } from "vitest";
import {
  DeleteWorkspaceOperation,
  SaveWorkspaceOperation,
  WorkspaceOperation,
  WorkspacesOperation,
} from "../../src/generated/operations.ts";
import { handleApiRequest, type Context } from "../../src/server/api.ts";
import type { RouterResult } from "../../src/server/router-client.ts";

const ID = "0b0e5a7c-3d0e-4c4f-9a2e-7f1c2d3e4f50";
const summary = { id: ID, name: "Checkout", updatedAt: "2026-11-19T10:00:00.000Z" };
const full = {
  ...summary,
  drafts: [{ subgraph: "packages", sdl: "type Query { a: String }" }],
  operations: "query A { a }",
  screenMap: null,
};

const contextWith = (
  result: RouterResult,
  { accessToken }: { accessToken?: string } = { accessToken: "token-1" },
) => {
  const run = vi.fn(async () => result);
  const context = {
    router: { run },
    sandbox: { route: vi.fn() },
    canSignIn: true,
    accessToken,
  } as unknown as Context;
  return { context, run };
};

const query = async (context: Context, path: string, input?: unknown) => {
  const search = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await handleApiRequest(
    new Request(`http://web.test/api/trpc/${path}${search}`),
    context,
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const mutate = async (context: Context, path: string, input: unknown) => {
  const response = await handleApiRequest(
    new Request(`http://web.test/api/trpc/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
    context,
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const save = {
  name: "Checkout",
  drafts: full.drafts,
  operations: "query A { a }",
  screenMap: null,
};

describe("the workspace procedures", () => {
  it("[FR-WB-11] list, open, save and delete a signed-in user's workspaces with their token", async () => {
    const list = contextWith({ ok: true, data: { workspaces: [summary] }, incomplete: false });
    expect((await query(list.context, "workspaces")).body).toEqual({
      result: { data: [summary] },
    });
    expect(list.run).toHaveBeenCalledWith(WorkspacesOperation, {}, "token-1");

    const one = contextWith({ ok: true, data: { workspace: full }, incomplete: false });
    expect((await query(one.context, "workspace", { id: ID })).body).toEqual({
      result: { data: full },
    });
    expect(one.run).toHaveBeenCalledWith(WorkspaceOperation, { id: ID }, "token-1");

    const saved = contextWith({ ok: true, data: { saveWorkspace: summary }, incomplete: false });
    expect((await mutate(saved.context, "saveWorkspace", save)).body).toEqual({
      result: { data: summary },
    });
    expect(saved.run).toHaveBeenCalledWith(
      SaveWorkspaceOperation,
      { ...save, id: null },
      "token-1",
    );

    const gone = contextWith({ ok: true, data: { deleteWorkspace: true }, incomplete: false });
    expect((await mutate(gone.context, "deleteWorkspace", { id: ID })).body).toEqual({
      result: { data: true },
    });
    expect(gone.run).toHaveBeenCalledWith(DeleteWorkspaceOperation, { id: ID }, "token-1");
  });

  it("[GR-3] refuses everyone not signed in, before asking the router", async () => {
    const { context, run } = contextWith({ ok: true, data: {}, incomplete: false }, {});

    for (const answer of [
      await query(context, "workspaces"),
      await query(context, "workspace", { id: ID }),
      await mutate(context, "saveWorkspace", save),
      await mutate(context, "deleteWorkspace", { id: ID }),
    ]) {
      expect(answer.status).toBe(401);
      expect(answer.body).toMatchObject({ error: { message: "Sign in first" } });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("[GR-3] takes no user ID from the browser", async () => {
    const { context, run } = contextWith({
      ok: true,
      data: { saveWorkspace: summary },
      incomplete: false,
    });
    await mutate(context, "saveWorkspace", { ...save, userId: "someone-else" });

    expect(JSON.stringify(run.mock.calls)).not.toContain("someone-else");
  });

  it.each([
    ["an ID that isn't one", "workspace", { id: "1 OR 1=1" }],
    ["a name too long", "saveWorkspace", { ...save, name: "x".repeat(101) }],
    [
      "too many drafts",
      "saveWorkspace",
      { ...save, drafts: Array.from({ length: 21 }, () => full.drafts[0]) },
    ],
  ])("[FR-WB-11] refuses %s without asking the router", async (_, path, input) => {
    const { context, run } = contextWith({ ok: true, data: {}, incomplete: false });
    const answer =
      path === "workspace" ? await query(context, path, input) : await mutate(context, path, input);

    expect(answer.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    [["UNAUTHENTICATED"], 401, "Sign in first"],
    [["NOT_FOUND"], 404, "Not found"],
    [["WORKSPACE_LIMIT"], 412, "Keep at most 50 workspaces. Delete one first."],
    [["BAD_USER_INPUT"], 400, "Invalid input"],
    [undefined, 503, "The graph didn't answer"],
  ])(
    "[FR-WB-11] answers the subgraph's %j with %i and a fixed message",
    async (codes, status, message) => {
      const { context } = contextWith(codes === undefined ? { ok: false } : { ok: false, codes });
      const answer = await mutate(context, "saveWorkspace", save);

      expect(answer.status).toBe(status);
      expect(answer.body).toMatchObject({ error: { message } });
    },
  );

  it.each([
    ["a field nobody asked for", { workspaces: [{ ...summary, email: "a@b.example" }] }, false],
    ["a partial answer", { workspaces: [summary] }, true],
  ])("[GR-16] passes on no answer with %s", async (_, data, incomplete) => {
    const { context } = contextWith({ ok: true, data, incomplete });
    const answer = await query(context, "workspaces");

    expect(answer.status).toBe(503);
    expect(JSON.stringify(answer.body)).not.toContain("a@b.example");
  });

  it("[GR-4] refuses a NUL in any text, which Postgres would quote into its log", async () => {
    const { context, run } = contextWith({ ok: true, data: {}, incomplete: false });
    for (const input of [
      { ...save, name: "a\u0000" },
      { ...save, operations: "x\u0000" },
      { ...save, screenMap: "x\u0000" },
      { ...save, drafts: [{ subgraph: "a", sdl: "x\u0000" }] },
    ]) {
      expect((await mutate(context, "saveWorkspace", input)).status).toBe(400);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("[GR-3] says sign in when the subgraph refused a workspace beside a null answer", async () => {
    const { context } = contextWith({
      ok: true,
      data: { workspace: null },
      incomplete: true,
      codes: ["UNAUTHENTICATED"],
    });

    expect((await query(context, "workspace", { id: ID })).status).toBe(401);
  });

  it("[FR-WB-11] passes on no workspace whose ID isn't a UUID", async () => {
    const { context } = contextWith({
      ok: true,
      data: { workspaces: [{ ...summary, id: "../evil" }] },
      incomplete: false,
    });

    expect((await query(context, "workspaces")).status).toBe(503);
  });

  it("[FR-WB-11] reads a save far larger than any other call", async () => {
    const { context, run } = contextWith({
      ok: true,
      data: { saveWorkspace: summary },
      incomplete: false,
    });
    const large = { ...save, drafts: [{ subgraph: "a", sdl: "é".repeat(140_000) }] };

    expect((await mutate(context, "saveWorkspace", large)).status).toBe(200);
    expect(run).toHaveBeenCalled();
  });
});
