"use client";

import { useEffect, useState } from "react";
import { createLoadPackage, type LoadPackage } from "./package-client.ts";
import { PackageDetails } from "./package-details.tsx";
import type { PackageAnswer } from "./types.ts";

const defaultLoad = createLoadPackage();
const alert = "rounded-md bg-danger-soft p-3 text-danger";

/** Loads one package's page from the graph, with loading, empty and error states (FR-WB-8). */
export function PackageExplorer({
  name,
  load = defaultLoad,
}: {
  name: string;
  load?: LoadPackage;
}) {
  const [answer, setAnswer] = useState<{ name: string; answer: PackageAnswer } | null>(null);

  useEffect(() => {
    let current = true;
    void load(name).then((loaded) => {
      if (current) setAnswer({ name, answer: loaded });
    });
    return () => {
      current = false;
    };
  }, [name, load]);

  if (answer?.name !== name) return <p role="status">Loading {name}…</p>;
  const loaded = answer.answer;
  if (loaded.kind === "not-found") {
    return <p>npm has no package called {name}.</p>;
  }
  if (loaded.kind === "unavailable") {
    return (
      <p role="alert" className={alert}>
        {name} couldn&apos;t be loaded just now. Try again.
      </p>
    );
  }
  return (
    <>
      {loaded.incomplete ? (
        <p role="status" className="mb-4 rounded-md bg-warning-soft p-3 text-warning">
          Some sources didn&apos;t answer, so parts of this page are missing.
        </p>
      ) : null}
      <PackageDetails details={loaded.package} />
    </>
  );
}
