import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountControl, type Viewer } from "../src/account/account-control.tsx";
import { expectNoAxeViolations } from "./axe.ts";

vi.mock("next/navigation", () => ({ usePathname: () => "/impact" }));

const viewer = (answer: Viewer) => () => Promise.resolve(answer);

describe("AccountControl", () => {
  it("[FR-WB-10] offers sign-in, coming back to this page afterwards", async () => {
    render(<AccountControl loadViewer={viewer({ canSignIn: true, signedIn: false })} />);

    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe("/sign-in?returnTo=%2Fimpact");
  });

  it("[FR-WB-10] offers sign-out as a POST, and shows nothing about the user", async () => {
    const { container } = render(
      <AccountControl loadViewer={viewer({ canSignIn: true, signedIn: true })} />,
    );

    const button = await screen.findByRole("button", { name: "Sign out" });
    const form = button.closest("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe("/sign-out");
    expect(container.textContent).toBe("Sign out");
  });

  it.each([
    ["while the server hasn't answered", () => new Promise<Viewer>(() => undefined)],
    ["when the server has no user pool", viewer({ canSignIn: false, signedIn: false })],
    ["when the server can't say", () => Promise.reject(new Error("offline"))],
  ])("[FR-WB-10] shows nothing %s", async (_, loadViewer) => {
    const { container } = render(<AccountControl loadViewer={loadViewer} />);

    await new Promise((done) => setTimeout(done, 0));
    expect(container.innerHTML).toBe("");
  });

  it.each([
    ["signed out", { canSignIn: true, signedIn: false }, "Sign in"],
    ["signed in", { canSignIn: true, signedIn: true }, "Sign out"],
  ])("[NFR-9] has no axe violations when %s", async (_, answer, name) => {
    const { container } = render(<AccountControl loadViewer={viewer(answer)} />);

    await waitFor(() => expect(container.textContent).toBe(name));
    await expectNoAxeViolations(container);
  });
});
