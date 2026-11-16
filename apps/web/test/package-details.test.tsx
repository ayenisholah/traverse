import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import express from "./fixtures/router-page-express.json" with { type: "json" };
import { PackageDetails } from "../src/packages/package-details.tsx";
import type { PackageDetails as Details } from "../src/packages/types.ts";
import { expectNoAxeViolations } from "./axe.ts";

const page = express.data.package;
const details: Details = {
  name: page.name,
  latestVersion: page.latestVersion,
  license: page.license,
  weeklyDownloads: page.weeklyDownloads,
  recentVersions: ["5.3.0", "5.2.1"],
  versionCount: 290,
  dependencies: page.dependencies,
  repository: page.repository,
  advisories: page.advisories,
};

const section = (name: string) =>
  screen.getByRole("heading", { level: 2, name }).closest("section") as HTMLElement;

describe("PackageDetails", () => {
  it("[FR-WB-8] shows a real package's facts, advisories, repository, dependencies and versions", async () => {
    const { container } = render(<PackageDetails details={details} />);

    expect(screen.getByText(page.latestVersion, { selector: "dd" })).toBeTruthy();
    expect(screen.getByText(new Intl.NumberFormat("en").format(page.weeklyDownloads))).toBeTruthy();
    expect(within(section("Advisories")).getAllByRole("link")).toHaveLength(page.advisories.length);
    expect(
      within(section("Repository"))
        .getByRole("link", { name: "expressjs/express" })
        .getAttribute("href"),
    ).toBe("https://github.com/expressjs/express");
    const dependencies = section(`Dependencies (${String(page.dependencies.length)})`);
    expect(
      within(dependencies).getByRole("link", { name: "body-parser" }).getAttribute("href"),
    ).toBe("/packages/body-parser");
    expect(within(section("Versions")).getByText("The newest 2 of 290.")).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("says what's missing instead of showing nothing", () => {
    render(
      <PackageDetails
        details={{
          ...details,
          license: null,
          weeklyDownloads: null,
          dependencies: [],
          repository: null,
          advisories: [],
          versionCount: null,
          recentVersions: [],
        }}
      />,
    );

    expect(screen.getByText("None given")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByText("No GitHub repository found.")).toBeTruthy();
    expect(screen.getByText("OSV knows of no advisories for this package.")).toBeTruthy();
    expect(screen.getByText("This version has no dependencies.")).toBeTruthy();
    expect(screen.getByText("The version list couldn't be read just now.")).toBeTruthy();
  });

  it("[FR-SG-6] doesn't say there's no repository when a source didn't answer", () => {
    render(<PackageDetails details={{ ...details, repository: null }} incomplete />);

    expect(
      screen.getByText("No repository is shown, and a source didn't answer, so it may be missing."),
    ).toBeTruthy();
    expect(screen.queryByText("No GitHub repository found.")).toBeNull();
  });

  it("[FR-SG-6] never shows advisories it couldn't read as none", () => {
    render(<PackageDetails details={{ ...details, advisories: null }} />);

    expect(
      screen.getByText("Advisories couldn't be read just now, so none are shown."),
    ).toBeTruthy();
    expect(screen.queryByText("OSV knows of no advisories for this package.")).toBeNull();
  });

  it("[GR-13] makes no link of a repository address that isn't GitHub's", () => {
    render(
      <PackageDetails
        details={{
          ...details,
          repository: { url: "javascript:alert(1)", stars: 0, owner: "x", latestRelease: null },
        }}
      />,
    );

    expect(within(section("Repository")).queryByRole("link")).toBeNull();
    expect(screen.getByText("javascript:alert(1)")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
  });
});
