import { randomUUID } from "node:crypto";
import type { SaveInput } from "../../src/limits.ts";
import { MAX_WORKSPACES } from "../../src/limits.ts";
import type { Workspace, WorkspaceStore } from "../../src/store.ts";

/** The store's contract in memory, for resolver tests. test/postgres proves the real one. */
export const createMemoryStore = (): WorkspaceStore & { closed: boolean } => {
  const rows = new Map<string, Workspace & { userId: string }>();
  const own = (userId: string) => [...rows.values()].filter((row) => row.userId === userId);
  const strip = ({ userId: _, ...workspace }: Workspace & { userId: string }): Workspace =>
    workspace;
  const store = {
    closed: false,
    list: (userId: string) => Promise.resolve(own(userId).map(strip)),
    get: (userId: string, id: string) => {
      const row = rows.get(id);
      return Promise.resolve(row?.userId === userId ? strip(row) : undefined);
    },
    save: (userId: string, { id, ...input }: SaveInput) => {
      if (id !== undefined && rows.get(id)?.userId !== userId) {
        return Promise.resolve({ kind: "not-found" as const });
      }
      if (id === undefined && own(userId).length >= MAX_WORKSPACES) {
        return Promise.resolve({ kind: "full" as const });
      }
      const row = { ...input, id: id ?? randomUUID(), userId, updatedAt: new Date().toISOString() };
      rows.set(row.id, row);
      return Promise.resolve({ kind: "saved" as const, workspace: strip(row) });
    },
    delete: (userId: string, id: string) =>
      Promise.resolve(rows.get(id)?.userId === userId && rows.delete(id)),
    close: () => {
      store.closed = true;
      return Promise.resolve();
    },
  };
  return store;
};
