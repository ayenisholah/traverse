"use client";

import type { SchemaChangeFailure, SchemaChangeReport } from "@traverse/graph-core";
import { useEffect, useState } from "react";
import type { LoadViewer, Viewer } from "../account/account-control.tsx";
import { createApiClient } from "../api-client.ts";
import {
  createExplain,
  toExplainRequest,
  type Explain,
  type ExplainAnswer,
} from "./explain-request.ts";

interface ExplainPanelProps {
  /** The finished check, or nothing while it runs. */
  report: SchemaChangeReport | SchemaChangeFailure | undefined;
  explain?: Explain;
  loadViewer?: LoadViewer;
}

const askViewer: LoadViewer = () => createApiClient().viewer.query();

const NOT_SHOWN: Record<Exclude<ExplainAnswer["kind"], "explained">, string> = {
  invalid:
    "Couldn't explain this. The assistant's answer didn't match the result, so it isn't shown.",
  limit: "You've used today's explanations. Everything else still works.",
  "too-large": "This result is too large to explain.",
  unavailable: "The assistant isn't available right now. Everything else still works.",
};

function Explanation({ answer }: { answer: ExplainAnswer }) {
  if (answer.kind !== "explained") {
    return (
      <p role="alert" className="text-caption text-fg-muted">
        {NOT_SHOWN[answer.kind]}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p>{answer.summary}</p>
      <ul className="list-disc space-y-1 ps-5">
        {answer.points.map((point, index) => (
          // The points have no identity of their own, and are never reordered.
          <li key={index}>
            {point.text}
            {point.fields.length > 0 ? (
              <span className="text-caption text-fg-muted"> ({point.fields.join(", ")})</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-caption text-fg-muted">
        Written by an AI assistant, and checked against this result before it was shown.
      </p>
    </div>
  );
}

function AskButton({ asking, onAsk }: { asking: boolean; onAsk: () => void }) {
  return (
    <button
      type="button"
      disabled={asking}
      className="rounded-sm bg-brand px-4 py-2 text-on-brand disabled:opacity-60"
      onClick={onAsk}
    >
      {asking ? "Explaining…" : "Explain this result"}
    </button>
  );
}

/** Whether to offer an explanation for this report, and the one asked for it, if any. */
const useExplanation = ({
  report,
  explain = createExplain(),
  loadViewer = askViewer,
}: ExplainPanelProps) => {
  const [viewer, setViewer] = useState<Viewer & { canAsk?: boolean }>();
  const [asked, setAsked] = useState<{ report: unknown; answer?: ExplainAnswer }>();

  useEffect(() => {
    loadViewer().then(setViewer, () => undefined);
  }, [loadViewer]);

  const request = report === undefined ? undefined : toExplainRequest(report);
  if (viewer?.canAsk !== true || request === undefined) return { offered: false as const };
  // A new result clears the last explanation, which was about the old one.
  const current = asked?.report === report ? asked : undefined;
  const ask = async () => {
    setAsked({ report });
    const answer = await explain(request);
    setAsked((latest) => (latest?.report === report ? { report, answer } : latest));
  };
  return { offered: true as const, current, ask };
};

/**
 * Explains a finished check in plain words, for a signed-in user where the server has an
 * assistant (FR-AI-1). Without one it shows nothing, and the result above stands on its own
 * (FR-AI-4).
 */
export function ExplainPanel(props: ExplainPanelProps) {
  const explanation = useExplanation(props);
  if (!explanation.offered) return null;
  const { current, ask } = explanation;

  return (
    <section aria-labelledby="explain-heading" className="mt-4 space-y-2">
      <h3 id="explain-heading" className="text-subtitle">
        Explanation
      </h3>
      {current?.answer === undefined ? (
        <AskButton asking={current !== undefined} onAsk={() => void ask()} />
      ) : (
        <Explanation answer={current.answer} />
      )}
    </section>
  );
}
