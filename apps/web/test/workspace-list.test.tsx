import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkspacesPage, { metadata } from "../src/app/workspaces/page.live.tsx";
import type { Result, WorkspaceApi, WorkspaceSummary } from "../src/workspaces/workspace-client.ts";
import { WorkspaceList } from "../src/workspaces/workspace-list.tsx";
import { expectNoAxeViolations } from "./axe.ts";

const workspaces: WorkspaceSummary[] = [
  {
    id: "0b0e5a7c-3d0e-4c4f-9a2e-7f1c2d3e4f50",
    name: "Checkout",
    updatedAt: "2026-11-19T10:00:00.000Z",
  },
  {
    id: "1b0e5a7c-3d0e-4c4f-9a2e-7f1c2d3e4f51",
    name: "Search",
    updatedAt: "2026-11-18T09:30:00.000Z",
  },
];

const apiListing = (
  list: Promise<Result<WorkspaceSummary[]>>,
  remove: WorkspaceApi["remove"] = () => Promise.resolve({ ok: true, value: true }),
): WorkspaceApi => ({ list: () => list, open: vi.fn(), save: vi.fn(), remove });

describe("WorkspaceList", () => {
  it("[FR-WB-11] says it's loading", () => {
    render(<WorkspaceList api={apiListing(new Promise(() => undefined))} />);

    expect(screen.getByText("Loading your workspaces…")).toBeTruthy();
  });

  it("[FR-WB-11] lists each workspace, to open in the impact check", async () => {
    render(<WorkspaceList api={apiListing(Promise.resolve({ ok: true, value: workspaces }))} />);

    const open = await screen.findByRole("link", { name: "Checkout" });
    expect(open.getAttribute("href")).toBe(`/impact?workspace=${workspaces[0]?.id ?? ""}`);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Delete Search" })).toBeTruthy();
  });

  it("[FR-WB-11] deletes a workspace and says so", async () => {
    const remove = vi.fn<WorkspaceApi["remove"]>(() => Promise.resolve({ ok: true, value: true }));
    render(
      <WorkspaceList api={apiListing(Promise.resolve({ ok: true, value: workspaces }), remove)} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete Checkout" }));

    await screen.findByText("Deleted “Checkout”.");
    expect(remove).toHaveBeenCalledWith(workspaces[0]?.id);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(1);
  });

  it("[FR-WB-11] says when a delete fails, and keeps the workspace", async () => {
    const remove = () => Promise.resolve({ ok: false as const, failure: "unavailable" as const });
    render(
      <WorkspaceList api={apiListing(Promise.resolve({ ok: true, value: workspaces }), remove)} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete Search" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't delete “Search”. Try again.",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("[FR-WB-11] points to the impact check when there are none", async () => {
    render(<WorkspaceList api={apiListing(Promise.resolve({ ok: true, value: [] }))} />);

    expect(await screen.findByText(/No saved workspaces yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "impact check" }).getAttribute("href")).toBe("/impact");
  });

  it("[FR-WB-11] offers sign-in to someone signed out", async () => {
    render(
      <WorkspaceList api={apiListing(Promise.resolve({ ok: false, failure: "signed-out" }))} />,
    );

    expect((await screen.findByRole("link", { name: "Sign in" })).getAttribute("href")).toBe(
      "/sign-in?returnTo=%2Fworkspaces",
    );
  });

  it("[FR-WB-11] says when the list can't be loaded", async () => {
    render(
      <WorkspaceList api={apiListing(Promise.resolve({ ok: false, failure: "unavailable" }))} />,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Your workspaces couldn't be loaded.",
    );
  });

  it("[NFR-9] has no axe violations with workspaces listed", async () => {
    const { container } = render(
      <WorkspaceList api={apiListing(Promise.resolve({ ok: true, value: workspaces }))} />,
    );
    await screen.findByRole("list");

    await expectNoAxeViolations(container);
  });
});

describe("the workspaces page", () => {
  it("[FR-WB-11] has a heading and a title, and asks the server for the list", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        { error: { message: "x", code: -32_001, data: { code: "UNAUTHORIZED", httpStatus: 401 } } },
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<WorkspacesPage />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Your workspaces");
    expect(metadata.title).toBe("Your workspaces · Traverse");
    await screen.findByRole("link", { name: "Sign in" });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await expectNoAxeViolations(container);
    vi.unstubAllGlobals();
  });
});
