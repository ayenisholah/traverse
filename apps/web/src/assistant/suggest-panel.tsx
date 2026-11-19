"use client";

import type { SchemaChangeFailure, SchemaChangeReport } from "@traverse/graph-core";
import { useEffect, useMemo, useState } from "react";
import type { LoadViewer, Viewer } from "../account/account-control.tsx";
import { createApiClient } from "../api-client.ts";
import { diffLines, type DiffLine } from "./line-diff.ts";
import { createSuggest, type Suggest, type SuggestAnswer } from "./suggest-request.ts";

interface SuggestPanelProps {
  report: SchemaChangeReport | SchemaChangeFailure | undefined;
  /** The subgraph being edited, and every edited draft. */
  subgraph: string;
  drafts: Record<string, string>;
  operations: string;
  screens: string;
  onApply: (subgraph: string, sdl: string) => void;
  suggest?: Suggest;
  loadViewer?: LoadViewer;
}

const askViewer: LoadViewer = () => createApiClient().viewer.query();

const NOT_SHOWN: Record<Exclude<SuggestAnswer["kind"], "suggested">, string> = {
  invalid:
    "Couldn't suggest a safe change. The assistant's answer didn't pass composition, so it isn't shown.",
  "nothing-to-fix": "This draft breaks nothing, so there's nothing to fix.",
  "duplicate-names":
    "Give each operation its own name, so a suggestion can be checked against each one.",
  limit: "You've used today's suggestions. Everything else still works.",
  "too-large": "This draft is too large to suggest a change for.",
  unavailable: "The assistant isn't available right now. Everything else still works.",
};

const breaks = (report: SchemaChangeReport | SchemaChangeFailure) =>
  !report.success || report.operations.some(({ errors }) => errors.length > 0);

// Beyond this many line pairs the diff's table gets large, so the schema is shown whole instead.
const MAX_DIFF_CELLS = 2_000_000;

/** The lines the suggestion changes, worked out once per answer, or none if that's too costly. */
const useChanges = (draft: string, sdl: string): DiffLine[] | undefined =>
  useMemo(() => {
    const cells = (draft.split("\n").length + 1) * (sdl.split("\n").length + 1);
    if (cells > MAX_DIFF_CELLS) return undefined;
    return diffLines(draft, sdl).filter(({ kind }) => kind !== "same");
  }, [draft, sdl]);

function Changes({ changed, sdl }: { changed: DiffLine[] | undefined; sdl: string }) {
  if (changed === undefined) {
    return (
      <pre aria-label="Suggested schema" className="overflow-x-auto font-mono text-caption">
        {sdl}
      </pre>
    );
  }
  return (
    <ul aria-label="Changes to your draft" className="font-mono text-caption">
      {changed.map((line, index) => (
        // The lines have no identity of their own, and are never reordered.
        <li key={index}>
          {line.kind === "added" ? "+ " : "- "}
          <span className="sr-only">{line.kind === "added" ? "added" : "removed"}: </span>
          {line.text}
        </li>
      ))}
    </ul>
  );
}

function Suggestion({
  answer,
  draft,
  onApply,
}: {
  answer: SuggestAnswer;
  draft: string;
  onApply: (sdl: string) => void;
}) {
  if (answer.kind !== "suggested") {
    return (
      <p role="alert" className="text-caption text-fg-muted">
        {NOT_SHOWN[answer.kind]}
      </p>
    );
  }
  return <SuggestedChange answer={answer} draft={draft} onApply={onApply} />;
}

function SuggestedChange({
  answer,
  draft,
  onApply,
}: {
  answer: Extract<SuggestAnswer, { kind: "suggested" }>;
  draft: string;
  onApply: (sdl: string) => void;
}) {
  const changed = useChanges(draft, answer.sdl);
  return (
    <div className="space-y-2">
      <p>{answer.summary}</p>
      <p className="text-caption">
        Composition checked: it breaks {answer.brokenAfter} of your operations, down from{" "}
        {answer.brokenBefore}.
      </p>
      <Changes changed={changed} sdl={answer.sdl} />
      <button
        type="button"
        className="rounded-sm bg-brand px-4 py-2 text-on-brand"
        onClick={() => onApply(answer.sdl)}
      >
        Use this schema
      </button>
      <p className="text-caption text-fg-muted">
        Written by an AI assistant, and checked by real composition before it was shown.
      </p>
    </div>
  );
}

/** Only to someone who can ask, about a finished check that breaks something. */
const isOffered = (
  viewer: { canAsk?: boolean } | undefined,
  report: SchemaChangeReport | SchemaChangeFailure | undefined,
): report is SchemaChangeReport | SchemaChangeFailure =>
  viewer?.canAsk === true && report !== undefined && breaks(report);

const useSuggestion = ({
  report,
  subgraph,
  drafts,
  operations,
  screens,
  suggest = createSuggest(),
  loadViewer = askViewer,
}: SuggestPanelProps) => {
  const [viewer, setViewer] = useState<Viewer & { canAsk?: boolean }>();
  const [asked, setAsked] = useState<{
    report: unknown;
    subgraph: string;
    answer?: SuggestAnswer;
  }>();

  useEffect(() => {
    loadViewer().then(setViewer, () => undefined);
  }, [loadViewer]);

  const draft = drafts[subgraph];
  if (!isOffered(viewer, report) || draft === undefined) return { offered: false as const };
  // A new result, or another subgraph, clears the last suggestion, which was about that draft.
  const current = asked?.report === report && asked.subgraph === subgraph ? asked : undefined;
  const ask = async () => {
    setAsked({ report, subgraph });
    const answer = await suggest({ subgraph, drafts, operations, screens });
    setAsked((latest) =>
      latest?.report === report && latest.subgraph === subgraph
        ? { report, subgraph, answer }
        : latest,
    );
  };
  return { offered: true as const, current, ask, draft };
};

/**
 * Suggests a safer version of a breaking draft, for a signed-in user where the server has an
 * assistant (FR-AI-2). The server shows one only if real composition says it's safer (GR-12).
 */
export function SuggestPanel(props: SuggestPanelProps) {
  const suggestion = useSuggestion(props);
  if (!suggestion.offered) return null;
  const { current, ask, draft } = suggestion;

  return (
    <section aria-labelledby="suggest-heading" className="mt-4 space-y-2">
      <h3 id="suggest-heading" className="text-subtitle">
        Safer change
      </h3>
      {current?.answer === undefined ? (
        <button
          type="button"
          disabled={current !== undefined}
          className="rounded-sm bg-brand px-4 py-2 text-on-brand disabled:opacity-60"
          onClick={() => void ask()}
        >
          {current === undefined ? `Suggest a safe change to ${props.subgraph}` : "Suggesting…"}
        </button>
      ) : (
        <Suggestion
          answer={current.answer}
          draft={draft}
          // Applied to the subgraph it was asked about, which the server checked it for.
          onApply={(sdl) => props.onApply(current.subgraph, sdl)}
        />
      )}
    </section>
  );
}
