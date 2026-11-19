import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { MAX_WORKSPACES } from "../src/limits.ts";
import { createPostgresStore } from "../src/postgres-store.ts";

const ID = "0b0e5a7c-3d0e-4c4f-9a2e-7f1c2d3e4f50";
const row = {
  id: ID,
  name: "Checkout",
  drafts: [{ subgraph: "packages", sdl: "type Query { a: String }" }],
  operations: "query A { a }",
  screen_map: null,
  updated_at: new Date("2026-11-19T10:00:00Z"),
};
const workspace = {
  id: ID,
  name: "Checkout",
  drafts: row.drafts,
  operations: "query A { a }",
  screenMap: null,
  updatedAt: "2026-11-19T10:00:00.000Z",
};
const input = {
  id: undefined,
  name: "Checkout",
  drafts: row.drafts,
  operations: "query A { a }",
  screenMap: null,
};

/** A pool that answers every query with these rows, and records what it was asked. */
const poolAnswering = (rows: unknown[] = [], rowCount = rows.length) => {
  const query = vi.fn(() => Promise.resolve({ rows, rowCount }));
  const end = vi.fn(() => Promise.resolve());
  return { pool: { query, end } as unknown as pg.Pool, query, end };
};

const sent = (query: ReturnType<typeof poolAnswering>["query"]) =>
  query.mock.calls.map((call) => {
    const [sql, values] = call as unknown as [string, unknown[]];
    return { sql: sql.replace(/\s+/g, " "), values };
  });

describe("createPostgresStore", () => {
  it("[FR-SG-1] scopes every statement to the verified user, and sends values as parameters", async () => {
    const { pool, query } = poolAnswering([row], 1);
    const store = createPostgresStore(pool);
    await store.list("user-a");
    await store.get("user-a", ID);
    await store.save("user-a", input);
    await store.save("user-a", { ...input, id: ID });
    await store.delete("user-a", ID);

    for (const { sql, values } of sent(query)) {
      expect(sql).toMatch(/user_id = \$1/);
      expect(values[0]).toBe("user-a");
      expect(sql).not.toContain("user-a");
      expect(sql).not.toContain(ID);
    }
  });

  it("[FR-WB-11] reads rows as workspaces, newest first", async () => {
    const { pool, query } = poolAnswering([row]);
    const store = createPostgresStore(pool);

    expect(await store.list("user-a")).toEqual([workspace]);
    expect(sent(query)[0]?.sql).toContain("ORDER BY updated_at DESC");
    expect(await store.get("user-a", ID)).toEqual(workspace);
  });

  it("[FR-SG-1] reads another user's workspace as none", async () => {
    const { pool } = poolAnswering([]);

    expect(await createPostgresStore(pool).get("user-b", ID)).toBeUndefined();
  });

  it("[FR-WB-11] creates a workspace while the user has room, and stores drafts as JSON", async () => {
    const { pool, query } = poolAnswering([row]);

    expect(await createPostgresStore(pool).save("user-a", input)).toEqual({
      kind: "saved",
      workspace,
    });
    const [insert] = sent(query);
    expect(insert?.sql).toMatch(/^INSERT INTO workspaces/);
    expect(insert?.values).toEqual([
      "user-a",
      "Checkout",
      JSON.stringify(row.drafts),
      "query A { a }",
      null,
      MAX_WORKSPACES,
    ]);
  });

  it("[FR-WB-11] says when the user has no room left", async () => {
    const { pool } = poolAnswering([]);

    expect(await createPostgresStore(pool).save("user-a", input)).toEqual({ kind: "full" });
  });

  it("[FR-SG-1] updates only a workspace the user owns", async () => {
    const owned = poolAnswering([row]);
    const other = poolAnswering([]);

    expect(await createPostgresStore(owned.pool).save("user-a", { ...input, id: ID })).toEqual({
      kind: "saved",
      workspace,
    });
    expect(sent(owned.query)[0]?.sql).toMatch(
      /^UPDATE workspaces .* WHERE user_id = \$1 AND id = \$6/,
    );
    expect(await createPostgresStore(other.pool).save("user-b", { ...input, id: ID })).toEqual({
      kind: "not-found",
    });
  });

  it("[FR-SG-1] deletes only a workspace the user owns", async () => {
    expect(await createPostgresStore(poolAnswering([], 1).pool).delete("user-a", ID)).toBe(true);
    expect(await createPostgresStore(poolAnswering([], 0).pool).delete("user-b", ID)).toBe(false);
  });

  it("[FR-SG-9] closes its pool", async () => {
    const { pool, end } = poolAnswering();
    await createPostgresStore(pool).close();

    expect(end).toHaveBeenCalledOnce();
  });
});
