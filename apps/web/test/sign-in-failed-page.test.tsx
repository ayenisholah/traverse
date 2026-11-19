import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SignInFailedPage, { metadata } from "../src/app/auth/failed/page.live.tsx";
import { expectNoAxeViolations } from "./axe.ts";

describe("the sign-in failed page", () => {
  it("[FR-WB-10] says sign-in didn't finish, and offers to try again", () => {
    render(<SignInFailedPage />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sign-in didn't finish");
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/sign-in");
    expect(metadata.title).toBe("Sign-in didn't finish · Traverse");
  });

  it("[NFR-9] has no axe violations", async () => {
    const { container } = render(<SignInFailedPage />);

    await expectNoAxeViolations(container);
  });
});
