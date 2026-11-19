import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../src/migrate.ts";

/** A pool whose one client records each statement, and fails the one that matches `failOn`. */
const fakePool = (applied: string[] = [], failOn?: RegExp) => {
  const statements: string[] = [];
  const release = vi.fn();
  const client = {
    query: vi.fn((sql: string) => {
      statements.push(sql);
      if (failOn?.test(sql)) return Promise.reject(new Error("syntax error"));
      const rows = sql.startsWith("SELECT name") ? applied.map((name) => ({ name })) : [];
      return Promise.resolve({ rows });
    }),
    release,
  };
  const pool = { connect: () => Promise.resolve(client) } as unknown as pg.Pool;
  return { pool, statements, release };
};

const folderWith = (files: Record<string, string>) => {
  const folder = mkdtempSync(join(tmpdir(), "migrations-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(folder, name), sql);
  return pathToFileURL(`${folder}/`);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("migrate", () => {
  it("[FR-SG-9] applies each migration that hasn't run, in name order, each in a transaction", async () => {
    const folder = folderWith({
      "002-b.sql": "CREATE TABLE b ();",
      "001-a.sql": "CREATE TABLE a ();",
      "notes.txt": "not a migration",
    });
    const { pool, statements, release } = fakePool();

    expect(await migrate(pool, folder)).toEqual(["001-a.sql", "002-b.sql"]);
    const a = statements.indexOf("CREATE TABLE a ();");
    expect(statements.slice(a - 1, a + 3)).toEqual([
      "BEGIN",
      "CREATE TABLE a ();",
      "INSERT INTO schema_migrations (name) VALUES ($1)",
      "COMMIT",
    ]);
    expect(statements[0]).toBe("SELECT pg_advisory_lock($1)");
    expect(statements.at(-1)).toBe("SELECT pg_advisory_unlock($1)");
    expect(release).toHaveBeenCalledOnce();
  });

  it("[FR-SG-9] skips what has run", async () => {
    const folder = folderWith({ "001-a.sql": "CREATE TABLE a ();" });
    const { pool, statements } = fakePool(["001-a.sql"]);

    expect(await migrate(pool, folder)).toEqual([]);
    expect(statements).not.toContain("CREATE TABLE a ();");
  });

  it("[FR-SG-9] rolls a failed migration back, stops, and still lets go of the lock", async () => {
    const folder = folderWith({
      "001-a.sql": "CREATE TABLE a (;",
      "002-b.sql": "CREATE TABLE b ();",
    });
    const { pool, statements, release } = fakePool([], /CREATE TABLE a/);

    await expect(migrate(pool, folder)).rejects.toThrow("syntax error");
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("CREATE TABLE b ();");
    expect(statements.at(-1)).toBe("SELECT pg_advisory_unlock($1)");
    expect(release).toHaveBeenCalledOnce();
  });

  it("[FR-SG-9] releases the client even if unlocking fails", async () => {
    const folder = folderWith({});
    const { pool, release } = fakePool([], /unlock/);

    expect(await migrate(pool, folder)).toEqual([]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("[FR-SG-9] ships the workspaces table as its first migration", async () => {
    const { pool, statements } = fakePool();

    expect(await migrate(pool)).toEqual(["001-workspaces.sql"]);
    expect(statements.join("\n")).toContain(
      "CREATE INDEX workspaces_by_user ON workspaces (user_id",
    );
  });
});

describe("the migration entrypoint", () => {
  it("[FR-SG-9] applies the migrations, prints only their names, and closes the pool", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://traverse@127.0.0.1:1/traverse");
    vi.doMock("../src/migrate.ts", () => ({
      migrate: () => Promise.resolve(["001-workspaces.sql"]),
    }));
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await import("../src/migrate-main.ts");

    expect(write).toHaveBeenCalledWith('{"applied":["001-workspaces.sql"]}\n');
    vi.doUnmock("../src/migrate.ts");
    vi.unstubAllEnvs();
  });
});
