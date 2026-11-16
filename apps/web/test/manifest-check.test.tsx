import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ManifestCheck } from "../src/packages/manifest-check.tsx";
import type { CheckManifest } from "../src/packages/package-client.ts";
import type { DependencyResult, ManifestAnswer } from "../src/packages/types.ts";
import { expectNoAxeViolations } from "./axe.ts";

const advisory = {
  id: "GHSA-29mw-wpgm-hmr9",
  summary: "ReDoS",
  severity: "MODERATE",
  fixedIn: "4.17.21",
};
const RESULTS: DependencyResult[] = [
  {
    name: "lodash",
    range: "4.17.20",
    version: "4.17.20",
    status: "checked",
    latestVersion: "4.18.1",
    license: "MIT",
    advisories: [advisory],
  },
  {
    name: "ms",
    range: "^2.1.3",
    version: "2.1.3",
    status: "checked",
    latestVersion: "2.1.3",
    license: null,
    advisories: [],
  },
  {
    name: "zod",
    range: "^4.0.0",
    version: "4.0.0",
    status: "checked",
    latestVersion: "4.6.7",
    license: "MIT",
    advisories: null,
  },
  { name: "nope", range: "1.0.0", version: "1.0.0", status: "not-found" },
  { name: "busy", range: "1.0.0", version: "1.0.0", status: "unavailable" },
  {
    name: "local",
    range: "file:../x",
    status: "skipped",
    reason: "Not a version range from the npm registry",
  },
];

const setup = (check: CheckManifest) => {
  const user = userEvent.setup();
  const rendered = render(<ManifestCheck check={check} />);
  const paste = async (text: string) => {
    await user.click(screen.getByRole("textbox", { name: "package.json" }));
    await user.paste(text);
    await user.click(screen.getByRole("button", { name: "Check dependencies" }));
  };
  return { user, paste, ...rendered };
};

const row = (name: string) => screen.getByRole("rowheader", { name }).closest("tr") as HTMLElement;

describe("ManifestCheck", () => {
  it("[FR-WB-9] shows each dependency's licence and advisories, and says which version was checked", async () => {
    const check = vi.fn<CheckManifest>(async () => ({
      kind: "checked",
      dependencies: RESULTS,
      leftOut: 0,
    }));
    const { paste, container } = setup(check);

    expect(screen.getByText("Paste a package.json to check its dependencies.")).toBeTruthy();
    await paste('{"dependencies":{"lodash":"4.17.20"}}');

    expect(check).toHaveBeenCalledWith('{"dependencies":{"lodash":"4.17.20"}}');
    expect(
      await screen.findByText(
        /6 dependencies checked\. 1 has advisories for the version checked\./,
      ),
    ).toBeTruthy();
    expect(within(row("lodash")).getByRole("link", { name: "GHSA-29mw-wpgm-hmr9" })).toBeTruthy();
    expect(within(row("lodash")).getByText(/fixed in 4\.17\.21/)).toBeTruthy();
    expect(within(row("ms")).getByText("None given")).toBeTruthy();
    expect(within(row("ms")).getByText("No advisories.")).toBeTruthy();
    expect(within(row("zod")).getByText("Advisories couldn't be read just now.")).toBeTruthy();
    expect(within(row("nope")).getByText("npm has no package by this name.")).toBeTruthy();
    expect(within(row("busy")).getByText("Couldn't be checked just now.")).toBeTruthy();
    expect(within(row("local")).getByText(/Skipped: Not a version range/)).toBeTruthy();
    expect(within(row("lodash")).getByRole("link", { name: "lodash" }).getAttribute("href")).toBe(
      "/packages/lodash",
    );
    expect(within(row("nope")).queryByRole("link")).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("counts in the singular, and says how many it left out", async () => {
    const one = [RESULTS[1] as DependencyResult];
    const { paste } = setup(
      vi.fn<CheckManifest>(async () => ({ kind: "checked", dependencies: one, leftOut: 7 })),
    );

    await paste("{}");

    expect(
      await screen.findByText(
        "1 dependency checked. None has an advisory for the version checked. 7 more were left out: the check covers the first 100.",
      ),
    ).toBeTruthy();
  });

  it("says 'have' for more than one with advisories", async () => {
    const both = [RESULTS[0], { ...RESULTS[0], name: "lodash2" }] as DependencyResult[];
    const { paste } = setup(
      vi.fn<CheckManifest>(async () => ({ kind: "checked", dependencies: both, leftOut: 0 })),
    );

    await paste("{}");

    expect(await screen.findByText(/2 have advisories/)).toBeTruthy();
  });

  it("says why a paste couldn't be read", async () => {
    const { paste } = setup(
      vi.fn<CheckManifest>(async () => ({
        kind: "invalid",
        message: "This isn't a package.json.",
      })),
    );

    await paste("nope");

    expect((await screen.findByRole("alert")).textContent).toBe("This isn't a package.json.");
  });

  it("says when the check couldn't run", async () => {
    const { paste } = setup(vi.fn<CheckManifest>(async () => ({ kind: "unavailable" })));

    await paste("{}");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The check couldn't run just now. Try again.",
    );
  });

  it("says it's working, and shows only the latest check's answer", async () => {
    const finish: ((answer: ManifestAnswer) => void)[] = [];
    const check = vi.fn<CheckManifest>(() => new Promise((resolve) => finish.push(resolve)));
    const { paste, user } = setup(check);

    await paste("{}");
    expect(screen.getByRole("status").textContent).toBe("Checking the dependencies…");
    await user.click(screen.getByRole("button", { name: "Check dependencies" }));
    finish[1]?.({ kind: "invalid", message: "second" });
    await screen.findByText("second");
    finish[0]?.({ kind: "invalid", message: "first" });
    await Promise.resolve();

    expect(screen.queryByText("first")).toBeNull();
  });

  it("can't run with nothing pasted", () => {
    setup(vi.fn<CheckManifest>());

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Check dependencies" }).disabled,
    ).toBe(true);
  });
});
