import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PackageExplorer } from "../src/packages/package-explorer.tsx";
import type { PackageAnswer } from "../src/packages/types.ts";
import { expectNoAxeViolations } from "./axe.ts";

const found = (incomplete: boolean): PackageAnswer => ({
  kind: "found",
  incomplete,
  package: {
    name: "ms",
    latestVersion: "2.1.3",
    license: "MIT",
    weeklyDownloads: 1,
    recentVersions: ["2.1.3"],
    versionCount: 1,
    dependencies: [],
    repository: null,
    advisories: [],
  },
});

describe("PackageExplorer", () => {
  it("[FR-WB-8] says it's loading, then shows the package", async () => {
    let finish: (answer: PackageAnswer) => void = () => undefined;
    const load = vi.fn(() => new Promise<PackageAnswer>((resolve) => (finish = resolve)));
    const { container } = render(<PackageExplorer name="ms" load={load} />);

    expect(screen.getByRole("status").textContent).toBe("Loading ms…");
    finish(found(false));

    expect(await screen.findByText("2.1.3", { selector: "dd" })).toBeTruthy();
    expect(load).toHaveBeenCalledWith("ms");
    expect(screen.queryByRole("status")).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("[FR-SG-6] says when some sources didn't answer", async () => {
    render(<PackageExplorer name="ms" load={vi.fn(async () => found(true))} />);

    expect((await screen.findByRole("status")).textContent).toContain("Some sources didn't answer");
  });

  it("[FR-WB-8] says npm has no such package", async () => {
    render(
      <PackageExplorer name="zz" load={vi.fn(async () => ({ kind: "not-found" as const }))} />,
    );

    expect(await screen.findByText("npm has no package called zz.")).toBeTruthy();
  });

  it("[FR-WB-8] says when the package couldn't be loaded", async () => {
    render(
      <PackageExplorer name="ms" load={vi.fn(async () => ({ kind: "unavailable" as const }))} />,
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "ms couldn't be loaded just now. Try again.",
    );
  });

  it("shows a new package's state, not the last one's, and drops a late answer", async () => {
    const answers: Record<string, (answer: PackageAnswer) => void> = {};
    const load = vi.fn(
      (name: string) => new Promise<PackageAnswer>((resolve) => (answers[name] = resolve)),
    );
    const { rerender } = render(<PackageExplorer name="a" load={load} />);

    rerender(<PackageExplorer name="b" load={load} />);
    answers.a?.({ kind: "not-found" });
    await Promise.resolve();

    expect(screen.getByRole("status").textContent).toBe("Loading b…");
    answers.b?.({ kind: "not-found" });
    expect(await screen.findByText("npm has no package called b.")).toBeTruthy();
  });
});
