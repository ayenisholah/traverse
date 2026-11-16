import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PackageSearch } from "../src/packages/package-search.tsx";
import { expectNoAxeViolations } from "./axe.ts";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("PackageSearch", () => {
  it("[FR-WB-8] opens a package's page by name, scoped names included", async () => {
    const open = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<PackageSearch open={open} />);

    await user.type(screen.getByRole("textbox", { name: "Package name" }), " @types/ms ");
    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(open).toHaveBeenCalledWith("/packages/%40types/ms");
    await expectNoAxeViolations(container);
  });

  it("uses the app's router when given nothing else", async () => {
    const user = userEvent.setup();
    render(<PackageSearch />);

    await user.type(screen.getByRole("textbox", { name: "Package name" }), "ms{Enter}");

    expect(push).toHaveBeenCalledWith("/packages/ms");
  });

  it("[NFR-9] explains a name npm couldn't have, and clears it once the name changes", async () => {
    const open = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<PackageSearch open={open} />);
    const box = screen.getByRole("textbox", { name: "Package name" });

    await user.type(box, "../etc{Enter}");

    expect(open).not.toHaveBeenCalled();
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/isn't an npm package name/).id).toBe(
      box.getAttribute("aria-describedby"),
    );
    await expectNoAxeViolations(container);
    await user.type(box, "x");
    expect(box.getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByText(/isn't an npm package name/)).toBeNull();
  });
});
