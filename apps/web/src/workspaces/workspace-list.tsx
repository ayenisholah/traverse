"use client";

import { useEffect, useState } from "react";
import {
  createWorkspaceApi,
  type WorkspaceApi,
  type WorkspaceSummary,
} from "./workspace-client.ts";

type ListState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "unavailable" }
  | { kind: "ready"; workspaces: WorkspaceSummary[] };

const link = "text-brand-fg underline";
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

function ListBody({
  state,
  onRemove,
}: {
  state: ListState;
  onRemove: (workspace: WorkspaceSummary) => void;
}) {
  return (
    <>
      {state.kind === "loading" ? <p className="text-fg-muted">Loading your workspaces…</p> : null}
      {state.kind === "signed-out" ? (
        <p>
          Sign in to see your saved workspaces.{" "}
          <a className={link} href="/sign-in?returnTo=%2Fworkspaces">
            Sign in
          </a>
        </p>
      ) : null}
      {state.kind === "unavailable" ? (
        <p role="alert" className="text-danger-fg">
          Your workspaces couldn&apos;t be loaded. Try again later.
        </p>
      ) : null}
      {state.kind === "ready" && state.workspaces.length === 0 ? (
        <p>
          No saved workspaces yet. Save one from the{" "}
          <a className={link} href="/impact">
            impact check
          </a>
          .
        </p>
      ) : null}
      {state.kind === "ready" && state.workspaces.length > 0 ? (
        <ul className="divide-y divide-fg-subtle">
          {state.workspaces.map((workspace) => (
            <li key={workspace.id} className="flex flex-wrap items-center gap-4 py-2">
              <a className={link} href={`/impact?workspace=${workspace.id}`}>
                {workspace.name}
              </a>
              <span className="text-caption text-fg-muted">Saved {when(workspace.updatedAt)}</span>
              <button
                type="button"
                className="ms-auto text-danger-fg underline"
                onClick={() => onRemove(workspace)}
              >
                Delete <span className="sr-only">{workspace.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** A signed-in user's saved workspaces, newest first, each to open or delete (FR-WB-11). */
export function WorkspaceList({ api = createWorkspaceApi() }: { api?: WorkspaceApi }) {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [status, setStatus] = useState("");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    void api.list().then((result) => {
      if (result.ok) setState({ kind: "ready", workspaces: result.value });
      else setState({ kind: result.failure === "signed-out" ? "signed-out" : "unavailable" });
    });
    // Loads once. A new client each render would otherwise load again.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the list loads on mount only
  }, []);

  const remove = async ({ id, name }: WorkspaceSummary) => {
    setProblem("");
    const result = await api.remove(id);
    if (!result.ok) return setProblem(`Couldn't delete “${name}”. Try again.`);
    // Only a listed workspace can be deleted, so the list is ready.
    setState((previous) => ({
      kind: "ready",
      workspaces: (previous as Extract<ListState, { kind: "ready" }>).workspaces.filter(
        (each) => each.id !== id,
      ),
    }));
    setStatus(`Deleted “${name}”.`);
  };

  return (
    <div className="space-y-3">
      <ListBody state={state} onRemove={(workspace) => void remove(workspace)} />
      <p role="status" className="text-caption text-fg-muted">
        {status}
      </p>
      {problem === "" ? null : (
        <p role="alert" className="text-caption text-danger-fg">
          {problem}
        </p>
      )}
    </div>
  );
}
