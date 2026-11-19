"use client";

import { useEffect, useEffectEvent, useState, type FormEvent } from "react";
import type { LoadViewer, Viewer } from "../account/account-control.tsx";
import { createApiClient } from "../api-client.ts";
import {
  createWorkspaceApi,
  type Failure,
  type WorkspaceApi,
  type WorkspaceDraft,
} from "./workspace-client.ts";

/** What the impact check holds: edited drafts by subgraph, the operations and the screens. */
export interface WorkbenchState {
  drafts: Record<string, string>;
  operations: string;
  screens: string;
}

interface WorkspaceBarProps {
  current: WorkbenchState;
  onOpen: (opened: WorkbenchState) => void;
  api?: WorkspaceApi;
  loadViewer?: LoadViewer;
  /** The workspace to open, from the address. Read from the page when not given. */
  openId?: string | null;
}

const SAVE_FAILURES: Record<Failure, string> = {
  "signed-out": "Your session has ended. Sign in again to save.",
  "not-found": "That workspace has gone. Save again to keep this as a new one.",
  limit: "Keep at most 50 workspaces. Delete one first.",
  invalid: "This is over a limit: at most 20 drafts and 150,000 characters of schema.",
  unavailable: "Couldn't save. Try again.",
};

const field = "rounded-sm border border-fg-subtle bg-surface px-3 py-2 text-caption";
const link = "text-brand-fg underline";

const fromAddress = () => new URLSearchParams(window.location.search).get("workspace");
const askViewer: LoadViewer = () => createApiClient().viewer.query();

const toDraft = (current: WorkbenchState, name: string, id?: string): WorkspaceDraft => ({
  ...(id === undefined ? {} : { id }),
  name: name.trim(),
  drafts: Object.entries(current.drafts).map(([subgraph, sdl]) => ({ subgraph, sdl })),
  operations: current.operations,
  screenMap: current.screens === "" ? null : current.screens,
});

interface Opened {
  id: string;
  name: string;
}

/** Opens the workspace the address names, once the user is known to be signed in. */
const useOpenFromAddress = (
  { api, onOpen, openId }: Required<Pick<WorkspaceBarProps, "api" | "onOpen">> & WorkspaceBarProps,
  signedIn: boolean,
  report: (opened: Opened | undefined) => void,
) => {
  // Reads the latest callbacks without reopening each time a render makes new ones.
  const open = useEffectEvent(async (id: string) => {
    const result = await api.open(id);
    if (!result.ok || result.value === null) return report(undefined);
    const { value } = result;
    onOpen({
      drafts: Object.fromEntries(value.drafts.map(({ subgraph, sdl }) => [subgraph, sdl])),
      operations: value.operations,
      screens: value.screenMap ?? "",
    });
    report({ id: value.id, name: value.name });
  });
  useEffect(() => {
    const id = openId === undefined ? fromAddress() : openId;
    if (id !== null && signedIn) void open(id);
  }, [openId, signedIn]);
};

function SaveForm({
  name,
  saving,
  saved,
  onName,
  onSave,
}: {
  name: string;
  saving: boolean;
  saved: boolean;
  onName: (name: string) => void;
  onSave: (event: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSave} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="workspace-name" className="mb-1 block text-subtitle">
          Name
        </label>
        <input
          id="workspace-name"
          className={field}
          required
          maxLength={100}
          value={name}
          onChange={(event) => onName(event.target.value)}
        />
      </div>
      <button
        type="submit"
        disabled={saving}
        className="rounded-sm bg-brand px-4 py-2 text-on-brand disabled:opacity-60"
      >
        {saved ? "Save changes" : "Save"}
      </button>
      <a className={link} href="/workspaces">
        Your workspaces
      </a>
    </form>
  );
}

/** The bar's state: who is signed in, the open workspace, and what the last action said. */
const useWorkspace = (props: WorkspaceBarProps) => {
  const { current, api = createWorkspaceApi(), loadViewer = askViewer } = props;
  const [viewer, setViewer] = useState<Viewer | undefined>();
  const [id, setId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadViewer().then(setViewer, () => undefined);
  }, [loadViewer]);
  useOpenFromAddress({ ...props, api }, viewer?.signedIn === true, (opened) => {
    if (opened === undefined) return setProblem("That workspace couldn't be opened.");
    setId(opened.id);
    setName(opened.name);
    setStatus(`Opened “${opened.name}”.`);
  });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    setProblem("");
    const result = await api.save(toDraft(current, name, id));
    setSaving(false);
    if (result.ok) {
      setId(result.value.id);
      setStatus(`Saved “${result.value.name}”.`);
      return;
    }
    if (result.failure === "not-found") setId(undefined);
    setProblem(SAVE_FAILURES[result.failure]);
  };

  return { viewer, saved: id !== undefined, name, setName, status, problem, saving, save };
};

/**
 * Save and reopen the impact check, for a signed-in user of the server build (FR-WB-11). Nothing
 * here is shown in the static demo, or where the server has no user pool.
 */
export function WorkspaceBar(props: WorkspaceBarProps) {
  const { viewer, saved, name, setName, status, problem, saving, save } = useWorkspace(props);
  if (viewer?.canSignIn !== true) return null;

  return (
    <section aria-labelledby="workspace-heading" className="mb-4 space-y-2">
      <h2 id="workspace-heading" className="text-h6">
        Workspace
      </h2>
      {viewer.signedIn ? (
        <SaveForm
          name={name}
          saving={saving}
          saved={saved}
          onName={setName}
          onSave={(event) => void save(event)}
        />
      ) : (
        <p>
          Sign in to save these drafts and open them later.{" "}
          <a className={link} href="/sign-in?returnTo=%2Fimpact">
            Sign in
          </a>
        </p>
      )}
      <p role="status" className="text-caption text-fg-muted">
        {status}
      </p>
      {problem === "" ? null : (
        <p role="alert" className="text-caption text-danger-fg">
          {problem}
        </p>
      )}
    </section>
  );
}
