import { diagnosticCount, forceLinting } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OperationEditor } from "../src/operations/operation-editor.tsx";
import { expectNoAxeViolations } from "./axe.ts";

const SCHEMA = "type Package { name: String } type Query { package(name: String!): Package }";

const editor = () => {
  const view = EditorView.findFromDOM(screen.getByRole("textbox", { name: "Operation" }));
  if (view === null) throw new Error("No editor is mounted");
  return view;
};

const setup = (onChange = vi.fn()) => {
  const rendered = render(
    <OperationEditor
      id="operation"
      label="Operation"
      initialValue="query A { package(name: 1) { name } }"
      schemaSdl={SCHEMA}
      onChange={onChange}
    />,
  );
  return { onChange, ...rendered };
};

describe("OperationEditor", () => {
  it("[FR-WB-7] shows the starting operation in a labelled, multi-line text box", () => {
    setup();

    const box = screen.getByRole("textbox", { name: "Operation" });
    expect(box.getAttribute("aria-multiline")).toBe("true");
    expect(box.textContent).toContain("query A");
  });

  it("[FR-WB-7] reports each edit as the whole operation", () => {
    const { onChange } = setup();

    editor().dispatch({ changes: { from: 6, to: 7, insert: "Renamed" } });

    expect(onChange).toHaveBeenLastCalledWith("query Renamed { package(name: 1) { name } }");
  });

  it("reports nothing when only the cursor moves", () => {
    const { onChange } = setup();

    editor().dispatch({ selection: { anchor: 3 } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("[FR-WB-7] marks a field the schema doesn't have, and clears the mark once it's fixed", async () => {
    setup();
    const view = editor();

    view.dispatch({ changes: { from: 29, to: 33, insert: "nope" } });
    forceLinting(view);
    await waitFor(() => expect(diagnosticCount(view.state)).toBeGreaterThan(0));

    view.dispatch({ changes: { from: 29, to: 33, insert: "name" } });
    view.dispatch({ changes: { from: 24, to: 25, insert: '"x"' } });
    forceLinting(view);
    await waitFor(() => expect(diagnosticCount(view.state)).toBe(0));
  });

  it("calls the newest onChange, without rebuilding the editor and losing the text", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = setup(first);
    editor().dispatch({ changes: { from: 0, insert: "# kept\n" } });

    rerender(
      <OperationEditor
        id="operation"
        label="Operation"
        initialValue="replaced"
        schemaSdl={SCHEMA}
        onChange={second}
      />,
    );
    editor().dispatch({ changes: { from: 0, insert: "# more\n" } });

    expect(second).toHaveBeenLastCalledWith(expect.stringContaining("# kept"));
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("[NFR-9] leaves Tab alone, so a keyboard user can always leave the editor", () => {
    setup();
    const box = screen.getByRole("textbox", { name: "Operation" });
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });

    box.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(false);
    expect(editor().state.doc.toString()).toBe("query A { package(name: 1) { name } }");
  });

  it("removes the editor when the component goes away", () => {
    const { unmount, container } = setup();

    unmount();

    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("[NFR-9] has no axe violations", async () => {
    const { container } = setup();

    await expectNoAxeViolations(container);
  });
});
