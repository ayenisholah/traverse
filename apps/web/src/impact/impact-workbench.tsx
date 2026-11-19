"use client";

import type { SchemaChangeFailure, SchemaChangeReport, SubgraphInput } from "@traverse/graph-core";
import { useMemo, useState } from "react";
import { ExplainPanel } from "../assistant/explain-panel.tsx";
import { SuggestPanel } from "../assistant/suggest-panel.tsx";
import { WorkspaceBar, type WorkbenchState } from "../workspaces/workspace-bar.tsx";
import { createComposeWorker } from "./create-worker.ts";
import { SubgraphPicker, TextField } from "./draft-fields.tsx";
import { ImpactResults } from "./impact-results.tsx";
import { useImpactCheck } from "./use-impact-check.ts";

interface ImpactWorkbenchProps {
  subgraphs: SubgraphInput[];
  seedOperations: string;
  createWorker?: () => Worker;
  /** The server build, where a signed-in user can save and reopen this. */
  live?: boolean;
}

const applyDrafts = (subgraphs: SubgraphInput[], drafts: Record<string, string>) =>
  subgraphs.map((subgraph) => ({ ...subgraph, sdl: drafts[subgraph.name] ?? subgraph.sdl }));

const useWorkbench = (seedOperations: string, firstSubgraph: string) => {
  const [selected, setSelected] = useState(firstSubgraph);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [operations, setOperations] = useState(seedOperations);
  const [screens, setScreens] = useState("");
  const open = (opened: WorkbenchState) => {
    setDrafts(opened.drafts);
    setOperations(opened.operations);
    setScreens(opened.screens);
  };
  return {
    selected,
    setSelected,
    drafts,
    setDrafts,
    operations,
    setOperations,
    screens,
    setScreens,
    open,
  };
};

type Workbench = ReturnType<typeof useWorkbench>;

function WorkbenchFields({
  subgraphs,
  proposed,
  workbench,
}: {
  subgraphs: SubgraphInput[];
  proposed: SubgraphInput[];
  workbench: Workbench;
}) {
  const {
    selected,
    setSelected,
    drafts,
    setDrafts,
    operations,
    setOperations,
    screens,
    setScreens,
  } = workbench;
  const draft = proposed.find(({ name }) => name === selected) as SubgraphInput;
  return (
    <div className="min-w-0 space-y-4">
      <SubgraphPicker
        subgraphs={subgraphs}
        selected={selected}
        onSelect={setSelected}
        onReset={() => setDrafts({})}
      />
      <TextField
        id="draft"
        label={`Schema draft for ${selected}`}
        rows={16}
        value={draft.sdl}
        onChange={(value) => setDrafts({ ...drafts, [selected]: value })}
      />
      <TextField
        id="operations"
        label="Operations"
        rows={8}
        value={operations}
        onChange={setOperations}
      />
      <TextField
        id="screens"
        label="Screens (optional)"
        rows={3}
        value={screens}
        hint="One screen a line, as Screen name: Operation, Operation"
        onChange={setScreens}
      />
    </div>
  );
}

/** The assistant's help with a finished check, in the server build only. */
function AssistantPanels({
  report,
  workbench,
}: {
  report: SchemaChangeReport | SchemaChangeFailure | undefined;
  workbench: Workbench;
}) {
  const { selected, drafts, setDrafts, operations, screens } = workbench;
  return (
    <>
      <ExplainPanel report={report} />
      <SuggestPanel
        report={report}
        subgraph={selected}
        drafts={drafts}
        operations={operations}
        screens={screens}
        onApply={(subgraph, sdl) => setDrafts({ ...drafts, [subgraph]: sdl })}
      />
    </>
  );
}

export function ImpactWorkbench({
  subgraphs,
  seedOperations,
  createWorker = createComposeWorker,
  live = false,
}: ImpactWorkbenchProps) {
  const workbench = useWorkbench(seedOperations, (subgraphs[0] as SubgraphInput).name);
  const { drafts, operations, screens } = workbench;
  const input = useMemo(
    () => ({ current: subgraphs, proposed: applyDrafts(subgraphs, drafts), operations, screens }),
    [subgraphs, drafts, operations, screens],
  );
  const state = useImpactCheck(input, createWorker);

  return (
    <>
      {live ? (
        <WorkspaceBar current={{ drafts, operations, screens }} onOpen={workbench.open} />
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <WorkbenchFields subgraphs={subgraphs} proposed={input.proposed} workbench={workbench} />
        <section aria-labelledby="results-heading" className="min-w-0">
          <h2 id="results-heading" className="mb-2 text-h6">
            Results
          </h2>
          <ImpactResults state={state} />
          {live ? (
            <AssistantPanels
              report={state.status === "done" ? state.report : undefined}
              workbench={workbench}
            />
          ) : null}
        </section>
      </div>
    </>
  );
}
