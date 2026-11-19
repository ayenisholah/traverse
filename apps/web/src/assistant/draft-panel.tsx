"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { LoadViewer, Viewer } from "../account/account-control.tsx";
import { createApiClient } from "../api-client.ts";
import { createDraft, type Draft, type DraftAnswer } from "./draft-request.ts";

interface DraftPanelProps {
  /** Puts a drafted operation in the editor. It's only ever one the server validated. */
  onDrafted: (operation: string) => void;
  draft?: Draft;
  loadViewer?: LoadViewer;
}

const askViewer: LoadViewer = () => createApiClient().viewer.query();

const NOT_DRAFTED: Record<Exclude<DraftAnswer["kind"], "drafted">, string> = {
  invalid:
    "Couldn't draft an operation. The assistant's answer didn't validate against the schema, so it isn't shown.",
  limit: "You've used today's drafts. Everything else still works.",
  "too-large": "That description is too long to draft from.",
  unavailable: "The assistant isn't available right now. Everything else still works.",
};

const field = "w-full rounded-sm border border-fg-subtle bg-surface px-3 py-2 text-caption";

const useDraft = ({
  onDrafted,
  draft = createDraft(),
  loadViewer = askViewer,
}: DraftPanelProps) => {
  const [viewer, setViewer] = useState<Viewer & { canAsk?: boolean }>();
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    loadViewer().then(setViewer, () => undefined);
  }, [loadViewer]);

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    setProblem("");
    const answer = await draft(description.trim());
    setBusy(false);
    if (answer.kind === "drafted") {
      onDrafted(answer.operation);
      setStatus(`Drafted, and checked against the schema: ${answer.summary}`);
      return;
    }
    setProblem(NOT_DRAFTED[answer.kind]);
  };
  return {
    offered: viewer?.canAsk === true,
    description,
    setDescription,
    busy,
    status,
    problem,
    ask,
  };
};

/**
 * Drafts an operation from a description, for a signed-in user where the server has an assistant
 * (FR-AI-3). The editor gets only an operation that validated (GR-12).
 */
export function DraftPanel(props: DraftPanelProps) {
  const { offered, description, setDescription, busy, status, problem, ask } = useDraft(props);
  if (!offered) return null;

  return (
    <section aria-labelledby="draft-heading" className="space-y-2">
      <h2 id="draft-heading" className="text-h6">
        Draft an operation
      </h2>
      <form onSubmit={(event) => void ask(event)} className="space-y-2">
        <label htmlFor="draft-description" className="block text-subtitle">
          Describe the data you need
        </label>
        <textarea
          id="draft-description"
          rows={2}
          maxLength={1_000}
          className={field}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <button
          type="submit"
          disabled={busy || description.trim() === ""}
          className="rounded-sm bg-brand px-4 py-2 text-on-brand disabled:opacity-60"
        >
          {busy ? "Drafting…" : "Draft it"}
        </button>
      </form>
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
