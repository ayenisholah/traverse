import demoImpact from "../../generated/demo-impact.json";
import { ImpactWorkbench } from "../../impact/impact-workbench.tsx";

export const metadata = { title: "Impact check · Traverse" };

export default function ImpactPage() {
  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-h4">Impact check</h1>
      <p className="mb-4 text-fg-muted">
        Edit a schema to see whether it composes, and which operations and screens it breaks. Your
        drafts stay in this browser.
      </p>
      <ImpactWorkbench
        subgraphs={demoImpact.subgraphs}
        seedOperations={demoImpact.exampleQuery}
        live={process.env.TRAVERSE_BUILD === "server"}
      />
    </main>
  );
}
