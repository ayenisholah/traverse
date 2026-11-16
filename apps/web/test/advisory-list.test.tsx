import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdvisoryList } from "../src/packages/advisory-list.tsx";
import { expectNoAxeViolations } from "./axe.ts";

const advisory = { id: "GHSA-29mw-wpgm-hmr9", summary: "ReDoS in lodash", severity: "MODERATE" };

describe("AdvisoryList", () => {
  it("[FR-WB-8] links each advisory to OSV's page for it, with its severity and summary", async () => {
    const { container } = render(<AdvisoryList advisories={[advisory]} />);

    const link = screen.getByRole("link", { name: "GHSA-29mw-wpgm-hmr9" });
    expect(link.getAttribute("href")).toBe("https://osv.dev/vulnerability/GHSA-29mw-wpgm-hmr9");
    expect(container.textContent).toBe("GHSA-29mw-wpgm-hmr9 · moderate: ReDoS in lodash");
    await expectNoAxeViolations(container);
  });

  it("[FR-WB-9] says where each advisory is fixed, or that it isn't yet", () => {
    const { container } = render(
      <AdvisoryList
        fixes
        advisories={[
          { ...advisory, fixedIn: "4.17.21" },
          { ...advisory, id: "GHSA-aaaa-bbbb-cccc", severity: null, fixedIn: null },
        ]}
      />,
    );

    expect(container.textContent).toContain("fixed in 4.17.21");
    expect(container.textContent).toContain(
      "GHSA-aaaa-bbbb-cccc: ReDoS in lodash · no fix for this version yet",
    );
  });

  it("[GR-13] makes no link of an ID that isn't one of OSV's", () => {
    render(<AdvisoryList advisories={[{ ...advisory, id: "javascript:alert(1)" }]} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("javascript:alert(1)")).toBeTruthy();
  });
});
