import type { Route, RouteStep } from "../route/types.ts";
import { count } from "../graph-map/count.ts";

const stagesOf = ({ steps }: Route): RouteStep[][] => {
  const stages: RouteStep[][] = [];
  for (const step of steps) (stages[step.stage] ??= []).push(step);
  return stages;
};

const describe = (step: RouteStep, steps: RouteStep[]): string => {
  if (step.kind === "root") return "Starts the operation.";
  const sources = step.after
    .map((id) => steps.find((other) => other.id === id)?.subgraph)
    .filter((name) => name !== undefined);
  const where = step.path === null ? "Adds fields" : `Adds fields to ${step.path}`;
  return sources.length > 0
    ? `${where}, using the answer from ${sources.join(" and ")}.`
    : `${where}.`;
};

function Step({ step, steps }: { step: RouteStep; steps: RouteStep[] }) {
  return (
    <li className="rounded-sm border border-line bg-surface p-3">
      <p>
        <strong className="text-subtitle">{step.subgraph}</strong>{" "}
        <span className="text-fg-muted">{describe(step, steps)}</span>
      </p>
      <details className="mt-1">
        <summary className="text-brand-fg underline">What the router asks {step.subgraph}</summary>
        <pre
          tabIndex={0}
          role="region"
          aria-label={`The request to ${step.subgraph}`}
          className="mt-1 overflow-x-auto rounded-sm bg-surface-sunken p-2 text-caption"
        >
          {step.query}
        </pre>
      </details>
    </li>
  );
}

// Sizes in the drawing's own units, which the viewBox scales to the space it's given.
const BOX = { width: 150, height: 36, gapX: 60, gapY: 16 };

const position = (stage: number, row: number) => ({
  x: stage * (BOX.width + BOX.gapX),
  y: row * (BOX.height + BOX.gapY),
});

/** A picture of the same route. The list beside it says everything this shows (ADR 0019). */
function Outline({ stages }: { stages: RouteStep[][] }) {
  const placed = stages.flatMap((stage, column) =>
    stage.map((step, row) => ({ step, ...position(column, row) })),
  );
  const at = (id: number) => placed.find(({ step }) => step.id === id);
  const width = stages.length * (BOX.width + BOX.gapX) - BOX.gapX;
  const rows = Math.max(...stages.map((stage) => stage.length));
  const height = rows * (BOX.height + BOX.gapY) - BOX.gapY;

  return (
    <svg
      aria-hidden="true"
      data-testid="route-outline"
      viewBox={`-2 -2 ${String(width + 4)} ${String(height + 4)}`}
      className="mb-4 max-h-48 w-full max-w-2xl"
    >
      {placed.flatMap(({ step, x, y }) =>
        step.after.flatMap((id) => {
          const from = at(id);
          return from === undefined
            ? []
            : [
                <line
                  key={`${String(id)}-${String(step.id)}`}
                  x1={from.x + BOX.width}
                  y1={from.y + BOX.height / 2}
                  x2={x}
                  y2={y + BOX.height / 2}
                  className="stroke-fg-subtle"
                  strokeWidth={1.5}
                />,
              ];
        }),
      )}
      {placed.map(({ step, x, y }) => (
        <g key={step.id}>
          <rect
            x={x}
            y={y}
            width={BOX.width}
            height={BOX.height}
            rx={6}
            className="fill-surface stroke-fg-subtle"
            strokeWidth={1.5}
          />
          <text
            x={x + BOX.width / 2}
            y={y + BOX.height / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={13}
            className="fill-fg"
          >
            {step.subgraph}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** A query's route: which subgraphs the router calls, and in what order (FR-WB-7). */
export function RouteView({ route }: { route: Route }) {
  const stages = stagesOf(route);
  if (stages.length === 0) return <p>This operation needs no subgraph.</p>;
  const subgraphs = new Set(route.steps.map(({ subgraph }) => subgraph)).size;

  return (
    <div>
      <p className="mb-2">
        {count(route.steps.length, "request", "requests")} to{" "}
        {count(subgraphs, "subgraph", "subgraphs")}, in {count(stages.length, "stage", "stages")}.
      </p>
      <Outline stages={stages} />
      <ol className="space-y-3">
        {stages.map((stage, index) => (
          <li key={stage[0]?.id}>
            <h3 className="mb-1 text-subtitle">
              Stage {index + 1}
              {stage.length > 1 ? `: ${String(stage.length)} requests at the same time` : ""}
            </h3>
            <ul className="space-y-2">
              {stage.map((step) => (
                <Step key={step.id} step={step} steps={route.steps} />
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
