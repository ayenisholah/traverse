import pg from "pg";
import type { SaveInput } from "./limits.ts";
import { MAX_WORKSPACES } from "./limits.ts";
import type { SaveResult, Workspace, WorkspaceStore } from "./store.ts";

interface Row {
  id: string;
  name: string;
  drafts: { subgraph: string; sdl: string }[];
  operations: string;
  screen_map: string | null;
  updated_at: Date;
}

const COLUMNS = "id, name, drafts, operations, screen_map, updated_at";

const toWorkspace = (row: Row): Workspace => ({
  id: row.id,
  name: row.name,
  drafts: row.drafts,
  operations: row.operations,
  screenMap: row.screen_map,
  updatedAt: row.updated_at.toISOString(),
});

/**
 * Workspaces in Postgres. Every statement carries `user_id = $1`, the verified subject, so no
 * statement here can reach another user's row. Values travel as parameters, never in the SQL.
 */
export const createPostgresStore = (pool: pg.Pool): WorkspaceStore => ({
  list: async (userId) => {
    const { rows } = await pool.query<Row>(
      `SELECT ${COLUMNS} FROM workspaces WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId],
    );
    return rows.map(toWorkspace);
  },

  get: async (userId, id) => {
    const { rows } = await pool.query<Row>(
      `SELECT ${COLUMNS} FROM workspaces WHERE user_id = $1 AND id = $2`,
      [userId, id],
    );
    return rows[0] && toWorkspace(rows[0]);
  },

  save: async (userId, input: SaveInput): Promise<SaveResult> => {
    const values = [
      userId,
      input.name,
      JSON.stringify(input.drafts),
      input.operations,
      input.screenMap,
    ];
    if (input.id !== undefined) {
      const { rows } = await pool.query<Row>(
        `UPDATE workspaces SET name = $2, drafts = $3, operations = $4, screen_map = $5,
           updated_at = now()
         WHERE user_id = $1 AND id = $6 RETURNING ${COLUMNS}`,
        [...values, input.id],
      );
      return rows[0] ? { kind: "saved", workspace: toWorkspace(rows[0]) } : { kind: "not-found" };
    }
    // One statement, so two saves at once can't both slip under the limit by much.
    const { rows } = await pool.query<Row>(
      `INSERT INTO workspaces (user_id, name, drafts, operations, screen_map)
       SELECT $1, $2, $3, $4, $5
       WHERE (SELECT count(*) FROM workspaces WHERE user_id = $1) < $6
       RETURNING ${COLUMNS}`,
      [...values, MAX_WORKSPACES],
    );
    return rows[0] ? { kind: "saved", workspace: toWorkspace(rows[0]) } : { kind: "full" };
  },

  delete: async (userId, id) => {
    const { rowCount } = await pool.query("DELETE FROM workspaces WHERE user_id = $1 AND id = $2", [
      userId,
      id,
    ]);
    return rowCount === 1;
  },

  close: () => pool.end(),
});
