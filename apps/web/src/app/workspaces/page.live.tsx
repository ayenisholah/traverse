import { WorkspaceList } from "../../workspaces/workspace-list.tsx";

export const metadata = { title: "Your workspaces · Traverse" };

export default function WorkspacesPage() {
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <div>
        <h1 className="text-h4">Your workspaces</h1>
        <p className="text-fg-muted">
          Schema drafts, operations and screens you saved from the impact check.
        </p>
      </div>
      <WorkspaceList />
    </main>
  );
}
