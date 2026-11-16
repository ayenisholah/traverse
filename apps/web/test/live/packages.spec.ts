import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "../fixtures", name), "utf8");
const failure = (page: Page) => page.getByRole("main").getByRole("alert");

const checkManifest = async (page: Page, text: string) => {
  await page.goto("/packages", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "package.json" }).fill(text);
  await page.getByRole("button", { name: "Check dependencies" }).click();
};

test("[FR-WB-8] shows a real package's versions, repository and advisories from the graph", async ({
  page,
}) => {
  await page.goto("/packages/express", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { level: 1, name: "express" })).toBeVisible();
  const advisories = page
    .getByRole("region", { name: "Advisories" })
    .or(page.locator("section", { has: page.getByRole("heading", { name: "Advisories" }) }));
  await expect(advisories.getByRole("link")).toHaveCount(5);
  await expect(page.getByRole("link", { name: "expressjs/express" })).toBeVisible();
  await expect(page.getByText("The newest 20 of 290.")).toBeVisible();
});

test("[FR-WB-8] says npm has no such package", async ({ page }) => {
  await page.goto("/packages/zz-not-recorded", { waitUntil: "networkidle" });

  await expect(page.getByText("npm has no package called zz-not-recorded.")).toBeVisible();
});

test("[FR-WB-8] moves from search to a package to one of its dependencies, by keyboard alone", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Packages" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Packages" })).toBeVisible();

  await page.getByRole("textbox", { name: "Package name" }).focus();
  await page.keyboard.type("express");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "express" })).toBeVisible();

  await page.getByRole("link", { name: "body-parser" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "body-parser" })).toBeVisible();
  // body-parser isn't in the recordings, so the stub answers it as missing.
  await expect(page.getByText("npm has no package called body-parser.")).toBeVisible();
});

test("[FR-WB-9] checks a pasted package.json: licences, advisories and the version each range allows", async ({
  page,
}) => {
  await checkManifest(page, fixture("manifest-with-advisories.json"));

  await expect(
    page.getByText("2 dependencies listed. 2 checked: 1 has advisories for the version checked."),
  ).toBeVisible();
  const lodash = page.getByRole("row", { name: /^lodash/ });
  await expect(lodash.getByRole("cell").nth(1)).toHaveText("4.17.20");
  await expect(lodash.getByRole("link", { name: /^GHSA-/ })).toHaveCount(4);
  await expect(page.getByRole("row", { name: /^ms/ })).toContainText("No advisories.");
});

test("[FR-WB-9] says why it can't read a paste", async ({ page }) => {
  await checkManifest(page, "dependencies: lodash");

  await expect(failure(page)).toContainText("This isn't a package.json");
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("[NFR-9] a package's page has no WCAG 2.2 AA violations", async ({ page }) => {
      await page.goto("/packages/express", { waitUntil: "networkidle" });
      await expect(page.getByText("The newest 20 of 290.")).toBeVisible();

      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
    });

    test("[NFR-9] the check's results, a refusal and a bad name have no WCAG 2.2 AA violations", async ({
      page,
    }) => {
      await checkManifest(page, fixture("manifest-subgraph-kit.json"));
      await expect(page.getByText(/^7 dependencies listed\./)).toBeVisible();
      await page.getByRole("textbox", { name: "Package name" }).fill("../nope");
      await page.getByRole("button", { name: "Open" }).click();
      await expect(page.getByText(/isn't an npm package name/)).toBeVisible();

      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
    });
  });
}
