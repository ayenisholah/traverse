import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteNav } from "../src/site-nav.tsx";
import { expectNoAxeViolations } from "./axe.ts";

describe("SiteNav", () => {
  it("[FR-WB-2] links to the map and the impact check", () => {
    render(<SiteNav live={false} />);

    expect(screen.getByRole("link", { name: "Graph map" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Impact check" }).getAttribute("href")).toBe("/impact");
  });

  it("[FR-WB-15] links to no live route from the static demo, which doesn't have them", () => {
    render(<SiteNav live={false} />);

    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("[FR-WB-7] links to the operations page from the server build", () => {
    render(<SiteNav live />);

    expect(screen.getByRole("link", { name: "Operations" }).getAttribute("href")).toBe(
      "/operations",
    );
  });

  it("[FR-WB-13] has no axe violations", async () => {
    const { container } = render(<SiteNav live />);

    await expectNoAxeViolations(container);
  });
});
