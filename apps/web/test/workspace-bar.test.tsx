import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Viewer } from "../src/account/account-control.tsx";
import { WorkspaceBar, type WorkbenchState } from "../src/workspaces/workspace-bar.tsx";
import type { Failure, WorkspaceApi } from "../src/workspaces/workspace-client.ts";
import { expectNoAxeViolations } from "./axe.ts";

const ID = "0b0e5a7c-3d0e-4c4f-9a2e-7f1c2d3e4f50";
const summary = { id: ID, name: "Checkout", updatedAt: "2026-11-19T10:00:00.000Z" };
const current: WorkbenchState = {
  drafts: { packages: "type Query { a: String }" },
  operations: "query A { a }",
  screens: "",
};
const signedIn = () => Promise.resolve<Viewer>({ canSignIn: true, signedIn: true });

const fakeApi = (overrides: Partial<WorkspaceApi> = {}): WorkspaceApi => ({
  list: vi.fn(),
  open: vi.fn(),
  save: vi.fn(() => Promise.resolve({ ok: true as const, value: summary })),
  remove: vi.fn(),
  ...overrides,
});

const renderBar = (props: Partial<Parameters<typeof WorkspaceBar>[0]> = {}) => {
  const onOpen = vi.fn();
  const api = props.api ?? fakeApi();
  const view = render(
    <WorkspaceBar
      current={current}
      onOpen={onOpen}
      api={api}
      loadViewer={signedIn}
      openId={null}
      {...props}
    />,
  );
  return { ...view, onOpen, api };
};

const saveAs = async (name: string) => {
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
};

describe("WorkspaceBar", () => {
  it.each([
    ["while the server hasn't answered", () => new Promise<Viewer>(() => undefined)],
    [
      "where the server has no user pool",
      () => Promise.resolve({ canSignIn: false, signedIn: false }),
    ],
    ["when the server can't say", () => Promise.reject(new Error("offline"))],
  ])("[FR-WB-11] shows nothing %s", async (_, loadViewer) => {
    const { container } = renderBar({ loadViewer });

    await new Promise((done) => setTimeout(done, 0));
    expect(container.innerHTML).toBe("");
  });

  it("[FR-WB-11] offers sign-in to save, coming back to the impact check", async () => {
    renderBar({ loadViewer: () => Promise.resolve({ canSignIn: true, signedIn: false }) });

    expect((await screen.findByRole("link", { name: "Sign in" })).getAttribute("href")).toBe(
      "/sign-in?returnTo=%2Fimpact",
    );
  });

  it("[FR-WB-11] saves the edited drafts, operations and screens, then saves changes to the same one", async () => {
    const { api } = renderBar();
    await saveAs("  Checkout  ");

    await screen.findByText("Saved “Checkout”.");
    expect(api.save).toHaveBeenCalledWith({
      name: "Checkout",
      drafts: [{ subgraph: "packages", sdl: "type Query { a: String }" }],
      operations: "query A { a }",
      screenMap: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
    expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID }));
  });

  it("[FR-WB-11] keeps a screen map when there is one", async () => {
    const { api } = renderBar({ current: { ...current, screens: "Checkout: A" } });
    await saveAs("Checkout");

    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ screenMap: "Checkout: A" })),
    );
  });

  it.each([
    ["signed-out", "Your session has ended. Sign in again to save."],
    ["limit", "Keep at most 50 workspaces. Delete one first."],
    ["invalid", "This is over a limit: at most 20 drafts and 150,000 characters of schema."],
    ["unavailable", "Couldn't save. Try again."],
    ["not-found", "That workspace has gone. Save again to keep this as a new one."],
  ] as [Failure, string][])("[FR-WB-11] says why a save failed: %s", async (failure, message) => {
    renderBar({ api: fakeApi({ save: () => Promise.resolve({ ok: false, failure }) }) });
    await saveAs("Checkout");

    expect((await screen.findByRole("alert")).textContent).toContain(message);
  });

  it("[FR-WB-11] saves a gone workspace as a new one next time", async () => {
    const save = vi
      .fn<WorkspaceApi["save"]>()
      .mockResolvedValueOnce({ ok: true, value: summary })
      .mockResolvedValueOnce({ ok: false, failure: "not-found" })
      .mockResolvedValueOnce({ ok: true, value: summary });
    renderBar({ api: fakeApi({ save }) });
    await saveAs("Checkout");
    await screen.findByText("Saved “Checkout”.");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(save.mock.calls[2]?.[0]).not.toHaveProperty("id");
  });

  it("[FR-WB-11] reopens the workspace the address names", async () => {
    const open = vi.fn<WorkspaceApi["open"]>(() =>
      Promise.resolve({
        ok: true,
        value: {
          ...summary,
          drafts: [{ subgraph: "packages", sdl: "type Query { b: Int }" }],
          operations: "query B { b }",
          screenMap: "Cart: B",
        },
      }),
    );
    const { onOpen } = renderBar({ api: fakeApi({ open }), openId: ID });

    await screen.findByText("Opened “Checkout”.");
    expect(open).toHaveBeenCalledWith(ID);
    expect(onOpen).toHaveBeenCalledWith({
      drafts: { packages: "type Query { b: Int }" },
      operations: "query B { b }",
      screens: "Cart: B",
    });
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Checkout");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("[FR-WB-11] opens with no screen map as no screens", async () => {
    const open = vi.fn<WorkspaceApi["open"]>(() =>
      Promise.resolve({
        ok: true,
        value: { ...summary, drafts: [], operations: "", screenMap: null },
      }),
    );
    const { onOpen } = renderBar({ api: fakeApi({ open }), openId: ID });

    await waitFor(() =>
      expect(onOpen).toHaveBeenCalledWith({ drafts: {}, operations: "", screens: "" }),
    );
  });

  it.each([
    ["one that isn't there", Promise.resolve({ ok: true as const, value: null })],
    [
      "one that can't be read",
      Promise.resolve({ ok: false as const, failure: "unavailable" as const }),
    ],
  ])("[FR-WB-11] says when it can't open %s", async (_, answer) => {
    const { onOpen } = renderBar({ api: fakeApi({ open: () => answer }), openId: ID });

    expect((await screen.findByRole("alert")).textContent).toContain(
      "That workspace couldn't be opened.",
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("[FR-WB-11] reads the workspace to open from the address", async () => {
    window.history.replaceState(null, "", `/impact?workspace=${ID}`);
    const open = vi.fn<WorkspaceApi["open"]>(() => Promise.resolve({ ok: true, value: null }));
    renderBar({ api: fakeApi({ open }), openId: undefined });

    await waitFor(() => expect(open).toHaveBeenCalledWith(ID));
    window.history.replaceState(null, "", "/");
  });

  it("[NFR-9] has no axe violations, signed in with a message", async () => {
    const { container } = renderBar({
      api: fakeApi({ save: () => Promise.resolve({ ok: false, failure: "limit" }) }),
    });
    await saveAs("Checkout");
    await screen.findByRole("alert");

    await expectNoAxeViolations(container);
  });

  it("[FR-WB-11] asks this app's server whether anyone is signed in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ result: { data: { canSignIn: true, signedIn: false } } })),
    );
    render(<WorkspaceBar current={current} onOpen={vi.fn()} api={fakeApi()} openId={null} />);

    await screen.findByRole("link", { name: "Sign in" });
    vi.unstubAllGlobals();
  });
});
