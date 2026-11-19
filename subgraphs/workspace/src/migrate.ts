import { readdirSync, readFileSync } from "node:fs";
import type pg from "pg";

const MIGRATIONS = new URL("../migrations/", import.meta.url);
// Any fixed number: it only has to be the same for every copy of this runner.
const LOCK = 7_301_004;

/**
 * Applies each migration in `migrations/` that hasn't run, in name order, each in its own
 * transaction. A lock keeps two runners from applying the same one. The release task in M7 runs
 * this before the subgraphs deploy (FR-SG-8).
 */
export const migrate = async (pool: pg.Pool, folder: URL = MIGRATIONS): Promise<string[]> => {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const done = new Set(rows.map(({ name }) => name));
    const pending = readdirSync(folder)
      .filter((name) => name.endsWith(".sql") && !done.has(name))
      .sort();
    for (const name of pending) {
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(new URL(name, folder), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return pending;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK]).catch(() => undefined);
    client.release();
  }
};
