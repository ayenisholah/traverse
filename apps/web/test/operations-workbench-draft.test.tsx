import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OperationsWorkbench } from "../src/operations/operations-workbench.tsx";
import type { FetchRoute } from "../src/operations/route-client.ts";

const DRAFTED = 'query Drafted { package(name: "react") { name } }';

// Stands in for the panel, so this test is about what the workbench does with a draft.
vi.mock("../src/assistant/draft-panel.tsx", () => ({
  DraftPanel: ({ onDrafted }: { onDrafted: (operation: string) => void }) => (
    <button type="button" onClick={() => onDrafted(DRAFTED)}>
      Use the draft
    </button>
  ),
}));

describe("OperationsWorkbench with a drafted operation", () => {
  it("[FR-AI-3] puts the draft in the editor, and runs it", async () => {
    const fetchRoute = vi.fn<FetchRoute>(async () => ({ kind: "unavailable" }));
    const user = userEvent.setup();
    render(
      <OperationsWorkbench
        schemaSdl="type Package { name: String } type Query { package(name: String!): Package }"
        seedOperation='query Example { package(name: "x") { name } }'
        seedVariables=""
        fetchRoute={fetchRoute}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Use the draft" }));

    expect(screen.getByRole("textbox", { name: "Operation" }).textContent).toBe(DRAFTED);
    await user.click(screen.getByRole("button", { name: "Show route" }));
    expect(fetchRoute).toHaveBeenCalledWith(DRAFTED, {});
  });
});
