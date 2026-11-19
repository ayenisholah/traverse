import { act, fireEvent, render, screen } from "@testing-library/react";
import type { SchemaChangeReport } from "@traverse/graph-core";
import { describe, expect, it, vi } from "vitest";
import { SuggestPanel } from "../src/assistant/suggest-panel.tsx";
import type { Suggest, SuggestAnswer } from "../src/assistant/suggest-request.ts";
import { expectNothingShown, expectToAskServer } from "./assistant-panel.ts";
import { expectNoAxeViolations } from "./axe.ts";

const breaking: SchemaChangeReport = {
  success: true,
  changes: [{ coordinate: "A.b", kind: "removed", subgraphs: [{ name: "one" }] }],
  operations: [{ name: "Q", fields: ["A.b"], errors: ["Cannot query field b."] }],
  screens: [],
};
const draft = "type A {\n  a: Int\n}";
const suggested: SuggestAnswer = {
  kind: "suggested",
  sdl: 'type A {\n  a: Int\n  b: Int @deprecated(reason: "Use a")\n}',
  summary: "Keeps b, deprecated.",
  brokenBefore: 1,
  brokenAfter: 0,
};
const canAsk = () => Promise.resolve({ canSignIn: true, signedIn: true, canAsk: true });

const renderPanel = (suggest: Suggest, props: Partial<Parameters<typeof SuggestPanel>[0]> = {}) => {
  const onApply = vi.fn();
  const view = render(
    <SuggestPanel
      report={breaking}
      subgraph="one"
      drafts={{ one: draft }}
      operations="query Q { a { b } }"
      screens=""
      onApply={onApply}
      suggest={suggest}
      loadViewer={canAsk}
      {...props}
    />,
  );
  return { ...view, onApply };
};

const askFor = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Suggest a safe change to one" }));
};

describe("SuggestPanel", () => {
  it.each([
    [
      "to someone who can't ask",
      { loadViewer: () => Promise.resolve({ canSignIn: true, signedIn: false, canAsk: false }) },
    ],
    ["while the check runs", { report: undefined }],
    ["about a draft that breaks nothing", { report: { ...breaking, operations: [] } }],
    ["about a subgraph with no draft", { drafts: {} }],
    ["when the server can't say", { loadViewer: () => Promise.reject(new Error("offline")) }],
  ])("[FR-AI-4] shows nothing %s", async (_, props) => {
    const { container } = renderPanel(vi.fn(), props);

    await expectNothingShown(container);
  });

  it("[FR-AI-2] offers a change for a draft that doesn't compose", async () => {
    renderPanel(vi.fn(), { report: { success: false, failed: "proposed", errors: ["x"] } });

    expect(
      await screen.findByRole("button", { name: "Suggest a safe change to one" }),
    ).toBeTruthy();
  });

  it("[FR-AI-2] shows a checked suggestion as changes to the draft, and applies it", async () => {
    const suggest = vi.fn<Suggest>(() => Promise.resolve(suggested));
    const { onApply } = renderPanel(suggest);
    await askFor();

    expect(await screen.findByText("Keeps b, deprecated.")).toBeTruthy();
    expect(screen.getByText(/breaks 0 of your operations, down from 1/)).toBeTruthy();
    const changes = screen.getByRole("list", { name: "Changes to your draft" });
    expect(changes.textContent).toBe('+ added:   b: Int @deprecated(reason: "Use a")');
    expect(suggest).toHaveBeenCalledWith({
      subgraph: "one",
      drafts: { one: draft },
      operations: "query Q { a { b } }",
      screens: "",
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this schema" }));
    expect(onApply).toHaveBeenCalledWith(
      "one",
      suggested.kind === "suggested" ? suggested.sdl : "",
    );
  });

  it("[FR-AI-2] marks removed lines too", async () => {
    renderPanel(() =>
      Promise.resolve({ ...suggested, sdl: "type A {\n}", summary: "Drops a." } as SuggestAnswer),
    );
    await askFor();

    expect((await screen.findByRole("list", { name: "Changes to your draft" })).textContent).toBe(
      "- removed:   a: Int",
    );
  });

  it("[FR-AI-2] says it's suggesting while it waits", async () => {
    renderPanel(() => new Promise(() => undefined));
    await askFor();

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Suggesting…" }).disabled).toBe(
      true,
    );
  });

  it.each([
    [
      "invalid",
      "Couldn't suggest a safe change. The assistant's answer didn't pass composition, so it isn't shown.",
    ],
    ["nothing-to-fix", "This draft breaks nothing, so there's nothing to fix."],
    [
      "duplicate-names",
      "Give each operation its own name, so a suggestion can be checked against each one.",
    ],
    ["limit", "You've used today's suggestions. Everything else still works."],
    ["too-large", "This draft is too large to suggest a change for."],
    ["unavailable", "The assistant isn't available right now. Everything else still works."],
  ] as const)("[GR-12] says why there's no suggestion: %s", async (kind, message) => {
    renderPanel(() => Promise.resolve({ kind }));
    await askFor();

    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("[FR-AI-2] drops a late suggestion about a draft that has since changed", async () => {
    const finishes: ((answer: SuggestAnswer) => void)[] = [];
    const slow = () => new Promise<SuggestAnswer>((done) => finishes.push(done));
    const view = renderPanel(slow);
    await askFor();
    view.rerender(
      <SuggestPanel
        report={{ ...breaking }}
        subgraph="one"
        drafts={{ one: draft }}
        operations=""
        screens=""
        onApply={vi.fn()}
        suggest={slow}
        loadViewer={canAsk}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Suggest a safe change to one" }));
    act(() => finishes[0]?.({ ...suggested, summary: "About the old draft." }));
    await new Promise((done) => setTimeout(done, 0));

    expect(screen.queryByText("About the old draft.")).toBeNull();
    act(() => finishes[1]?.(suggested));
    expect(await screen.findByText("Keeps b, deprecated.")).toBeTruthy();
  });

  it("[FR-AI-4] asks this app's server whether the assistant is offered", async () => {
    await expectToAskServer(() =>
      render(
        <SuggestPanel
          report={breaking}
          subgraph="one"
          drafts={{ one: draft }}
          operations=""
          screens=""
          onApply={vi.fn()}
        />,
      ),
    );
  });

  it("[NFR-9] has no axe violations with a suggestion shown", async () => {
    const { container } = renderPanel(() => Promise.resolve(suggested));
    await askFor();
    await screen.findByText("Keeps b, deprecated.");

    await expectNoAxeViolations(container);
  });

  it("[GR-12] drops a suggestion once another subgraph is picked, and never applies it there", async () => {
    const view = renderPanel(() => Promise.resolve(suggested), {
      drafts: { one: draft, two: draft },
    });
    await askFor();
    await screen.findByText("Keeps b, deprecated.");
    const onApply = vi.fn();
    view.rerender(
      <SuggestPanel
        report={breaking}
        subgraph="two"
        drafts={{ one: draft, two: draft }}
        operations=""
        screens=""
        onApply={onApply}
        suggest={() => Promise.resolve(suggested)}
        loadViewer={canAsk}
      />,
    );

    expect(screen.queryByText("Keeps b, deprecated.")).toBeNull();
    expect(screen.getByRole("button", { name: "Suggest a safe change to two" })).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("[FR-AI-2] shows a very large suggestion whole, rather than working out every change", async () => {
    const long = Array.from({ length: 1_500 }, (_, i) => `# line ${String(i)}`).join("\n");
    renderPanel(() => Promise.resolve({ ...suggested, sdl: `${long}\nmore` } as SuggestAnswer), {
      drafts: { one: long },
    });
    await askFor();

    expect((await screen.findByLabelText("Suggested schema")).textContent).toContain("more");
    expect(screen.queryByRole("list", { name: "Changes to your draft" })).toBeNull();
  });
});
