"use client";

import { useRef, useState, type FormEvent } from "react";
import { TextField } from "../impact/draft-fields.tsx";
import type { RouteAnswer } from "../route/types.ts";
import { OperationEditor } from "./operation-editor.tsx";
import { createFetchRoute, type FetchRoute } from "./route-client.ts";
import { RouteView } from "./route-view.tsx";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "bad-variables" }
  | { status: "done"; answer: RouteAnswer };

interface OperationsWorkbenchProps {
  schemaSdl: string;
  seedOperation: string;
  seedVariables: string;
  fetchRoute?: FetchRoute;
}

const defaultFetchRoute = createFetchRoute();
const alert = "rounded-md bg-danger-soft p-3 text-danger";

const parseVariables = (text: string): Record<string, unknown> | undefined => {
  if (text.trim() === "") return {};
  try {
    const value: unknown = JSON.parse(text);
    const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
    return isObject ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

function Answer({ state }: { state: State }) {
  if (state.status === "idle") {
    return <p className="text-fg-muted">Run an operation to see which subgraphs answer it.</p>;
  }
  if (state.status === "loading") return <p role="status">Finding the route…</p>;
  if (state.status === "bad-variables") {
    return (
      <p role="alert" className={alert}>
        The variables must be a JSON object, such as {'{ "name": "express" }'}.
      </p>
    );
  }
  const { answer } = state;
  if (answer.kind === "route") return <RouteView route={answer.route} />;
  if (answer.kind === "unavailable") {
    return (
      <p role="alert" className={alert}>
        The route couldn&apos;t be worked out just now. Try again.
      </p>
    );
  }
  return (
    <div role="alert" className={alert}>
      <p>The router refused this operation:</p>
      <ul className="list-disc pl-5">
        {answer.messages.map((message, index) => (
          <li key={index}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

/** Write an operation, run it, and see its route. Only the latest run's answer is shown. */
export function OperationsWorkbench({
  schemaSdl,
  seedOperation,
  seedVariables,
  fetchRoute = defaultFetchRoute,
}: OperationsWorkbenchProps) {
  const [operation, setOperation] = useState(seedOperation);
  const [variables, setVariables] = useState(seedVariables);
  const [state, setState] = useState<State>({ status: "idle" });
  const latest = useRef(0);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseVariables(variables);
    const id = (latest.current += 1);
    if (parsed === undefined) {
      setState({ status: "bad-variables" });
      return;
    }
    setState({ status: "loading" });
    const answer = await fetchRoute(operation, parsed);
    if (id === latest.current) setState({ status: "done", answer });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form className="min-w-0 space-y-4" onSubmit={(event) => void run(event)}>
        <OperationEditor
          id="operation"
          label="Operation"
          initialValue={seedOperation}
          schemaSdl={schemaSdl}
          onChange={setOperation}
        />
        <TextField
          id="variables"
          label="Variables (optional)"
          rows={3}
          value={variables}
          hint="A JSON object"
          onChange={setVariables}
        />
        <button
          type="submit"
          disabled={operation.trim() === ""}
          className="rounded-sm bg-brand px-4 py-2 text-on-brand disabled:opacity-60"
        >
          Show route
        </button>
      </form>
      <section aria-labelledby="route-heading" aria-live="polite" className="min-w-0">
        <h2 id="route-heading" className="mb-2 text-h6">
          Route
        </h2>
        <Answer state={state} />
      </section>
    </div>
  );
}
