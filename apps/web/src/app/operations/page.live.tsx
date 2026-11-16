import { clientSchemaSdl } from "../../generated/schema.ts";
import { OperationsWorkbench } from "../../operations/operations-workbench.tsx";

export const metadata = { title: "Operations · Traverse" };

const EXAMPLE = `query Example($name: String!) {
  package(name: $name) {
    name
    latestVersion
    repository {
      stars
    }
    advisories {
      id
      severity
    }
  }
}
`;

export default function OperationsPage() {
  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-h4">Operations</h1>
      <p className="mb-4 text-fg-muted">
        Write a query to see its route: which subgraphs the router calls, and in what order. Queries
        only. The operation runs on live data, and only its route comes back.
      </p>
      <OperationsWorkbench
        schemaSdl={clientSchemaSdl}
        seedOperation={EXAMPLE}
        seedVariables={'{ "name": "express" }'}
      />
    </main>
  );
}
