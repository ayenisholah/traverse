import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DraftPanel } from "../src/assistant/draft-panel.tsx";
import { createDraft, type Draft, type DraftAnswer } from "../src/assistant/draft-request.ts";
import { expectNothingShown, expectToAskServer, NOT_OFFERED } from "./assistant-panel.ts";
import { expectNoAxeViolations } from "./axe.ts";

const canAsk = () => Promise.resolve({ canSignIn: true, signedIn: true, canAsk: true });
const drafted: DraftAnswer = {
  kind: "drafted",
  operation: 'query License { package(name: "react") { license } }',
  summary: "Reads react's licence.",
};

const renderPanel = (draft: Draft, props: Partial<Parameters<typeof DraftPanel>[0]> = {}) => {
  const onDrafted = vi.fn();
  const view = render(
    <DraftPanel onDrafted={onDrafted} draft={draft} loadViewer={canAsk} {...props} />,
  );
  return { ...view, onDrafted };
};

const describeAndAsk = async (text: string) => {
  fireEvent.change(await screen.findByLabelText("Describe the data you need"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Draft it" }));
};

describe("DraftPanel", () => {
  it.each(NOT_OFFERED)("[FR-AI-4] shows nothing %s", async (_, props) => {
    const { container } = renderPanel(vi.fn(), props);

    await expectNothingShown(container);
  });

  it("[FR-AI-3] puts a validated operation in the editor, and says what it reads", async () => {
    const draft = vi.fn<Draft>(() => Promise.resolve(drafted));
    const { onDrafted } = renderPanel(draft);
    await describeAndAsk("  react's licence  ");

    await screen.findByText("Drafted, and checked against the schema: Reads react's licence.");
    expect(draft).toHaveBeenCalledWith("react's licence");
    expect(onDrafted).toHaveBeenCalledWith(drafted.kind === "drafted" ? drafted.operation : "");
  });

  it("[FR-AI-3] can't be asked with nothing described, and says it's drafting while it waits", async () => {
    renderPanel(() => new Promise(() => undefined));

    expect(
      (await screen.findByRole<HTMLButtonElement>("button", { name: "Draft it" })).disabled,
    ).toBe(true);
    await describeAndAsk("a licence");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Drafting…" }).disabled).toBe(
      true,
    );
  });

  it.each([
    [
      "invalid",
      "Couldn't draft an operation. The assistant's answer didn't validate against the schema, so it isn't shown.",
    ],
    ["limit", "You've used today's drafts. Everything else still works."],
    ["too-large", "That description is too long to draft from."],
    ["unavailable", "The assistant isn't available right now. Everything else still works."],
  ] as const)("[GR-12] puts nothing in the editor, and says why: %s", async (kind, message) => {
    const { onDrafted } = renderPanel(() => Promise.resolve({ kind }));
    await describeAndAsk("a licence");

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(onDrafted).not.toHaveBeenCalled();
  });

  it("[FR-AI-4] asks this app's server whether the assistant is offered", async () => {
    await expectToAskServer(() => render(<DraftPanel onDrafted={vi.fn()} />));
  });

  it("[NFR-9] has no axe violations, drafted or refused", async () => {
    const { container } = renderPanel(() => Promise.resolve(drafted));
    await describeAndAsk("a licence");
    await screen.findByText(/Drafted, and checked/);

    await expectNoAxeViolations(container);
  });
});

describe("createDraft", () => {
  it("[FR-AI-4] reads a call that fails as unavailable", async () => {
    const draft = createDraft(vi.fn<typeof fetch>(() => Promise.reject(new Error("offline"))));

    expect(await draft("a licence")).toEqual({ kind: "unavailable" });
  });
});
