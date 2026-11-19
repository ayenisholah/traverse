import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImpactWorkbench } from "../src/impact/impact-workbench.tsx";
import type { WorkbenchState } from "../src/workspaces/workspace-bar.tsx";

// Stands in for the bar, so this test is about what the workbench gives it and does with an open.
vi.mock("../src/workspaces/workspace-bar.tsx", () => ({
  WorkspaceBar: ({
    current,
    onOpen,
  }: {
    current: WorkbenchState;
    onOpen: (opened: WorkbenchState) => void;
  }) => (
    <div>
      <output aria-label="Bar sees">{JSON.stringify(current)}</output>
      <button
        type="button"
        onClick={() =>
          onOpen({
            drafts: { a: "type Query { opened: Int }" },
            operations: "{ opened }",
            screens: "S: X",
          })
        }
      >
        Open saved
      </button>
    </div>
  ),
}));

const subgraphs = [{ name: "a", sdl: "type Query { a: Int }" }];
const createWorker = () => ({ postMessage: vi.fn(), terminate: vi.fn() }) as unknown as Worker;
const valueOf = (name: string | RegExp) =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name }).value;

describe("ImpactWorkbench in the server build", () => {
  it("[FR-WB-11] gives the workspace bar what's being edited", () => {
    render(
      <ImpactWorkbench
        subgraphs={subgraphs}
        seedOperations="{ a }"
        createWorker={createWorker}
        live
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /Schema draft/ }), {
      target: { value: "type Query { b: Int }" },
    });

    expect(JSON.parse(screen.getByLabelText("Bar sees").textContent)).toEqual({
      drafts: { a: "type Query { b: Int }" },
      operations: "{ a }",
      screens: "",
    });
  });

  it("[FR-WB-11] fills the drafts, operations and screens from an opened workspace", () => {
    render(
      <ImpactWorkbench
        subgraphs={subgraphs}
        seedOperations="{ a }"
        createWorker={createWorker}
        live
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open saved" }));

    expect(valueOf(/Schema draft/)).toBe("type Query { opened: Int }");
    expect(valueOf("Operations")).toBe("{ opened }");
    expect(valueOf("Screens (optional)")).toBe("S: X");
  });

  it("[FR-WB-15] shows no workspace bar in the static demo", () => {
    render(
      <ImpactWorkbench subgraphs={subgraphs} seedOperations="{ a }" createWorker={createWorker} />,
    );

    expect(screen.queryByRole("button", { name: "Open saved" })).toBeNull();
  });
});
