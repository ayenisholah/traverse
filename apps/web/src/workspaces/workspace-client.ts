import { createApiClient } from "../api-client.ts";

export interface WorkspaceSummary {
  id: string;
  name: string;
  updatedAt: string;
}

interface SavedWorkspace extends WorkspaceSummary {
  drafts: { subgraph: string; sdl: string }[];
  operations: string;
  screenMap: string | null;
}

export interface WorkspaceDraft {
  id?: string;
  name: string;
  drafts: { subgraph: string; sdl: string }[];
  operations: string;
  screenMap: string | null;
}

/** Why a call didn't work, in terms the page can say. */
export type Failure = "signed-out" | "not-found" | "limit" | "invalid" | "unavailable";
export type Result<T> = { ok: true; value: T } | { ok: false; failure: Failure };

export interface WorkspaceApi {
  list: () => Promise<Result<WorkspaceSummary[]>>;
  open: (id: string) => Promise<Result<SavedWorkspace | null>>;
  save: (draft: WorkspaceDraft) => Promise<Result<WorkspaceSummary>>;
  remove: (id: string) => Promise<Result<boolean>>;
}

const FAILURES: Record<string, Failure> = {
  UNAUTHORIZED: "signed-out",
  NOT_FOUND: "not-found",
  PRECONDITION_FAILED: "limit",
  BAD_REQUEST: "invalid",
};

const settle = <T>(call: Promise<T>): Promise<Result<T>> =>
  call.then(
    (value): Result<T> => ({ ok: true, value }),
    (error: unknown): Result<T> => {
      // tRPC's client error carries the server's code, which api.ts holds to a fixed set.
      const code = (error as { data?: { code?: string } }).data?.code ?? "";
      return { ok: false, failure: FAILURES[code] ?? "unavailable" };
    },
  );

/** The signed-in user's workspaces, through this app's own server. */
export const createWorkspaceApi = (fetch?: typeof globalThis.fetch): WorkspaceApi => {
  const client = createApiClient(fetch);
  return {
    list: () => settle(client.workspaces.query()),
    open: (id) => settle(client.workspace.query({ id })),
    save: (draft) => settle(client.saveWorkspace.mutate(draft)),
    remove: (id) => settle(client.deleteWorkspace.mutate({ id })),
  };
};
