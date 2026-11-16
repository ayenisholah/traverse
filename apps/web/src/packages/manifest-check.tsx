"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { TextField } from "../impact/draft-fields.tsx";
import { AdvisoryList } from "./advisory-list.tsx";
import { createCheckManifest, type CheckManifest } from "./package-client.ts";
import { packagePath } from "./package-path.ts";
import { summarise } from "./summary.ts";
import type { DependencyResult, ManifestAnswer } from "./types.ts";

type State =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "done"; answer: ManifestAnswer | { kind: "unavailable" } };

const defaultCheck = createCheckManifest();
const alert = "rounded-md bg-danger-soft p-3 text-danger";

function Findings({ result }: { result: DependencyResult }) {
  if (result.status === "skipped")
    return <span className="text-fg-muted">Skipped: {result.reason}</span>;
  if (result.status === "not-found") return <span>npm has no package by this name.</span>;
  if (result.status === "unavailable") {
    return <span className="text-warning">Couldn&apos;t be checked just now.</span>;
  }
  if (result.advisories === null) {
    return <span className="text-warning">Advisories couldn&apos;t be read just now.</span>;
  }
  if (result.advisories.length === 0) return <span>No advisories.</span>;
  return <AdvisoryList advisories={result.advisories} fixes />;
}

function ResultRow({ result }: { result: DependencyResult }) {
  return (
    <tr className="border-t border-line align-top">
      <th scope="row" className="py-1 pr-4 text-left font-normal">
        {result.status === "checked" ? (
          <Link className="text-brand-fg underline" href={packagePath(result.name)}>
            {result.name}
          </Link>
        ) : (
          result.name
        )}
      </th>
      <td className="py-1 pr-4 text-fg-muted">{result.range}</td>
      <td className="py-1 pr-4">{"version" in result ? result.version : ""}</td>
      <td className="py-1 pr-4">
        {result.status === "checked" ? (result.license ?? "None given") : ""}
      </td>
      <td className="py-1">
        <Findings result={result} />
      </td>
    </tr>
  );
}

function Results({ answer }: { answer: ManifestAnswer & { kind: "checked" } }) {
  const { dependencies, leftOut } = answer;
  return (
    <div>
      <p className="mb-2">{summarise(dependencies, leftOut)}</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Dependency results">
        <table className="w-full">
          <caption className="sr-only">Licence and advisories for each dependency</caption>
          <thead>
            <tr className="text-left text-caption text-fg-muted">
              <th scope="col" className="pr-4 font-normal">
                Package
              </th>
              <th scope="col" className="pr-4 font-normal">
                Range
              </th>
              <th scope="col" className="pr-4 font-normal">
                Version checked
              </th>
              <th scope="col" className="pr-4 font-normal">
                Licence
              </th>
              <th scope="col" className="font-normal">
                Advisories
              </th>
            </tr>
          </thead>
          <tbody>
            {dependencies.map((result, index) => (
              // Two names npm couldn't have can be cut to the same text, so the row is keyed by place.
              <ResultRow key={index} result={result} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Outcome({ state }: { state: State }) {
  if (state.status === "idle") {
    return <p className="text-fg-muted">Paste a package.json to check its dependencies.</p>;
  }
  if (state.status === "checking") return <p role="status">Checking the dependencies…</p>;
  const { answer } = state;
  if (answer.kind === "unavailable") {
    return (
      <p role="alert" className={alert}>
        The check couldn&apos;t run just now. Try again.
      </p>
    );
  }
  if (answer.kind === "invalid") {
    return (
      <p role="alert" className={alert}>
        {answer.message}
      </p>
    );
  }
  return <Results answer={answer} />;
}

/** Paste a package.json and see each dependency's licence and advisories (FR-WB-9). */
export function ManifestCheck({ check = defaultCheck }: { check?: CheckManifest }) {
  const [manifest, setManifest] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const latest = useRef(0);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    const id = (latest.current += 1);
    setState({ status: "checking" });
    const answer = await check(manifest);
    if (id === latest.current) setState({ status: "done", answer });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
      <form className="min-w-0 space-y-3" onSubmit={(event) => void run(event)}>
        <TextField
          id="manifest"
          label="package.json"
          rows={12}
          value={manifest}
          hint="Only dependencies and devDependencies are read, and their names are looked up on npm and OSV. Advisories are for the lowest version each range allows."
          onChange={setManifest}
        />
        <button
          type="submit"
          disabled={manifest.trim() === ""}
          className="rounded-sm bg-brand px-4 py-2 text-on-brand disabled:opacity-60"
        >
          Check dependencies
        </button>
      </form>
      <section aria-labelledby="check-heading" aria-live="polite" className="min-w-0">
        <h2 id="check-heading" className="mb-2 text-h6">
          Dependencies
        </h2>
        <Outcome state={state} />
      </section>
    </div>
  );
}
