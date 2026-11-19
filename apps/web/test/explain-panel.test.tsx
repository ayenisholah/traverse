import { act, fireEvent, render, screen } from "@testing-library/react";
import type { SchemaChangeReport } from "@traverse/graph-core";
import { describe, expect, it, vi } from "vitest";
import { ExplainPanel } from "../src/assistant/explain-panel.tsx";
import type { Explain, ExplainAnswer } from "../src/assistant/explain-request.ts";
import { expectNothingShown, expectToAskServer } from "./assistant-panel.ts";
import { expectNoAxeViolations } from "./axe.ts";

const report: SchemaChangeReport = {
  success: true,
  changes: [{ coordinate: "A.b", kind: "removed", subgraphs: [{ name: "one" }] }],
  operations: [{ name: "Q", fields: ["A.b"], errors: ["Cannot query field b."] }],
  screens: [],
};
const canAsk = () => Promise.resolve({ canSignIn: true, signedIn: true, canAsk: true });
const explained: ExplainAnswer = {
  kind: "explained",
  summary: "Removing A.b breaks Q.",
  points: [
    { text: "A.b was removed.", fields: ["A.b"] },
    { text: "Q reads it.", fields: [] },
  ],
};

const renderPanel = (explain: Explain, props: Partial<Parameters<typeof ExplainPanel>[0]> = {}) =>
  render(<ExplainPanel report={report} explain={explain} loadViewer={canAsk} {...props} />);

describe("ExplainPanel", () => {
  it.each([
    [
      "to someone who can't ask",
      { loadViewer: () => Promise.resolve({ canSignIn: true, signedIn: false, canAsk: false }) },
    ],
    ["when the server can't say", { loadViewer: () => Promise.reject(new Error("offline")) }],
    ["while the check runs", { report: undefined }],
    ["about a clean result", { report: { ...report, changes: [], operations: [] } }],
  ])("[FR-AI-4] shows nothing %s", async (_, props) => {
    const { container } = renderPanel(vi.fn(), props);

    await expectNothingShown(container);
  });

  it("[FR-AI-1] explains the result in plain points that name its fields, marked as AI", async () => {
    const explain = vi.fn<Explain>(() => Promise.resolve(explained));
    renderPanel(explain);
    fireEvent.click(await screen.findByRole("button", { name: "Explain this result" }));

    expect(await screen.findByText("Removing A.b breaks Q.")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "A.b was removed. (A.b)",
      "Q reads it.",
    ]);
    expect(screen.getByText(/Written by an AI assistant/)).toBeTruthy();
    expect(explain).toHaveBeenCalledWith(expect.objectContaining({ kind: "impact" }));
  });

  it("[FR-AI-1] says it's explaining while it waits", async () => {
    renderPanel(() => new Promise(() => undefined));
    fireEvent.click(await screen.findByRole("button", { name: "Explain this result" }));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Explaining…" }).disabled).toBe(
      true,
    );
  });

  it.each([
    [
      "invalid",
      "Couldn't explain this. The assistant's answer didn't match the result, so it isn't shown.",
    ],
    ["limit", "You've used today's explanations. Everything else still works."],
    ["too-large", "This result is too large to explain."],
    ["unavailable", "The assistant isn't available right now. Everything else still works."],
  ] as const)("[GR-12] says why there's no explanation: %s", async (kind, message) => {
    renderPanel(() => Promise.resolve({ kind }));
    fireEvent.click(await screen.findByRole("button", { name: "Explain this result" }));

    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("[FR-AI-1] drops an explanation once the result it was about changes", async () => {
    const view = renderPanel(() => Promise.resolve(explained));
    fireEvent.click(await screen.findByRole("button", { name: "Explain this result" }));
    await screen.findByText("Removing A.b breaks Q.");
    view.rerender(
      <ExplainPanel
        report={{ ...report }}
        explain={() => Promise.resolve(explained)}
        loadViewer={canAsk}
      />,
    );

    expect(screen.queryByText("Removing A.b breaks Q.")).toBeNull();
    expect(screen.getByRole("button", { name: "Explain this result" })).toBeTruthy();
  });

  it("[FR-AI-1] ignores a late answer about a result that has since changed", async () => {
    const finishes: ((answer: ExplainAnswer) => void)[] = [];
    const slow = () => new Promise<ExplainAnswer>((done) => finishes.push(done));
    const view = renderPanel(slow);
    fireEvent.click(await screen.findByRole("button", { name: "Explain this result" }));
    view.rerender(<ExplainPanel report={{ ...report }} explain={slow} loadViewer={canAsk} />);
    fireEvent.click(screen.getByRole("button", { name: "Explain this result" }));
    act(() => finishes[0]?.({ ...explained, summary: "About the old result." }));
    await new Promise((done) => setTimeout(done, 0));

    expect(screen.queryByText("About the old result.")).toBeNull();
    expect(screen.getByRole("button", { name: "Explaining…" })).toBeTruthy();
    act(() => finishes[1]?.(explained));
    expect(await screen.findByText("Removing A.b breaks Q.")).toBeTruthy();
  });

  it("[NFR-9] has no axe violations, explained or not", async () => {
    const { container } = renderPanel(() => Promise.resolve(explained));
    fireEvent.click(await screen.findByRole("button", { name: "Explain this result" }));
    await screen.findByText("Removing A.b breaks Q.");

    await expectNoAxeViolations(container);
  });

  it("[FR-AI-4] asks this app's server whether the assistant is offered", async () => {
    await expectToAskServer(() => render(<ExplainPanel report={report} />));
  });
});
