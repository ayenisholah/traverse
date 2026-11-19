import type { SaveInput } from "./limits.ts";

export interface Workspace {
  id: string;
  name: string;
  drafts: { subgraph: string; sdl: string }[];
  operations: string;
  screenMap: string | null;
  updatedAt: string;
}

/**
 * Users' workspaces. Every method takes the verified user's ID first and touches only that user's
 * rows, so a workspace someone else owns is indistinguishable from one that doesn't exist.
 */
export interface WorkspaceStore {
  list: (userId: string) => Promise<Workspace[]>;
  get: (userId: string, id: string) => Promise<Workspace | undefined>;
  /** A new workspace without an ID, or an update to one of the user's own. */
  save: (userId: string, input: SaveInput) => Promise<SaveResult>;
  delete: (userId: string, id: string) => Promise<boolean>;
  close: () => Promise<void>;
}

export type SaveResult =
  { kind: "saved"; workspace: Workspace } | { kind: "not-found" } | { kind: "full" };
