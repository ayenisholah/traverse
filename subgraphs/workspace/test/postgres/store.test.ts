import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_WORKSPACES } from "../../src/limits.ts";
import { migrate } from "../../src/migrate.ts";
import { createPostgresStore } from "../../src/postgres-store.ts";
import { startDatabase, type Database } from "./database.ts";

let database: Database;

beforeAll(async () => {
  database = await startDatabase(5433);
  const pool = database.pool();
  await migrate(pool);
  await pool.end();
}, 120_000);

afterAll(() => {
  database.stop();
});

const drafts = [{ subgraph: "packages", sdl: "type Query { a: String }" }];
const input = (name: string) => ({
  id: undefined,
  name,
  drafts,
  operations: "query A { a }",
  screenMap: "Checkout: A",
});

const saved = async (store: ReturnType<typeof createPostgresStore>, user: string, name: string) => {
  const result = await store.save(user, input(name));
  if (result.kind !== "saved") throw new Error(`not saved: ${result.kind}`);
  return result.workspace;
};

describe("workspaces in Postgres", () => {
  it("[FR-SG-1] one user can't read, change or delete another's workspace", async () => {
    const store = createPostgresStore(database.pool());
    try {
      const ada = await saved(store, "ada", "Ada's");

      expect(await store.list("grace")).toEqual([]);
      expect(await store.get("grace", ada.id)).toBeUndefined();
      expect(await store.save("grace", { ...input("Taken"), id: ada.id })).toEqual({
        kind: "not-found",
      });
      expect(await store.delete("grace", ada.id)).toBe(false);
      expect(await store.get("ada", ada.id)).toEqual(ada);
    } finally {
      await store.close();
    }
  });

  it("[FR-SG-9] keeps saved drafts and screen maps across a restart", async () => {
    const first = createPostgresStore(database.pool());
    const kept = await saved(first, "linus", "Kept");
    await first.close();

    const second = createPostgresStore(database.pool());
    try {
      expect(await second.get("linus", kept.id)).toEqual(kept);
      expect(kept).toMatchObject({ drafts, operations: "query A { a }", screenMap: "Checkout: A" });
    } finally {
      await second.close();
    }
  });

  it("[FR-WB-11] updates and deletes a user's own workspace, newest first", async () => {
    const store = createPostgresStore(database.pool());
    try {
      const older = await saved(store, "barbara", "Older");
      const newer = await saved(store, "barbara", "Newer");
      const renamed = await store.save("barbara", { ...input("Renamed"), id: older.id });

      expect(renamed).toMatchObject({
        kind: "saved",
        workspace: { id: older.id, name: "Renamed" },
      });
      expect((await store.list("barbara")).map(({ name }) => name)).toEqual(["Renamed", "Newer"]);
      expect(await store.delete("barbara", newer.id)).toBe(true);
      expect((await store.list("barbara")).map(({ id }) => id)).toEqual([older.id]);
    } finally {
      await store.close();
    }
  });

  it("[FR-WB-11] stops at the most workspaces one user may keep", async () => {
    const store = createPostgresStore(database.pool());
    try {
      for (let i = 0; i < MAX_WORKSPACES; i += 1) await saved(store, "margaret", `W${String(i)}`);

      expect(await store.save("margaret", input("One more"))).toEqual({ kind: "full" });
      expect((await store.save("katherine", input("Another user"))).kind).toBe("saved");
    } finally {
      await store.close();
    }
  });

  it("[FR-SG-9] runs each migration once, however often it's asked", async () => {
    const pool = database.pool();
    try {
      expect(await migrate(pool)).toEqual([]);
      const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
      expect(rows.map(({ name }) => name)).toEqual(["001-workspaces.sql"]);
    } finally {
      await pool.end();
    }
  });
});
