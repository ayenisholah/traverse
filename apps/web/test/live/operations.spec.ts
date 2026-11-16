import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const editor = (page: Page) => page.getByRole("textbox", { name: "Operation" });
// Next adds its own hidden alert for route changes, so this looks inside the page content.
const failure = (page: Page) => page.getByRole("main").getByRole("alert");

const open = async (page: Page) => {
  await page.goto("/operations", { waitUntil: "networkidle" });
  await expect(editor(page)).toContainText("query Example");
};

const showRoute = async (page: Page) => {
  await page.getByRole("button", { name: "Show route" }).click();
  await expect(page.getByText("3 requests to 3 subgraphs, in 2 stages.")).toBeVisible();
};

test("[FR-WB-7] shows a query's route: the subgraphs, and the order they're called in", async ({
  page,
}) => {
  const hosts = new Set<string>();
  page.on("request", (request) => hosts.add(new URL(request.url()).host));
  await open(page);

  await showRoute(page);

  const stages = page.getByRole("main").getByRole("heading", { level: 3 });
  await expect(stages).toHaveText(["Stage 1", "Stage 2: 2 requests at the same time"]);
  await expect(page.getByRole("main").locator("li strong")).toHaveText([
    "packages",
    "repositories",
    "advisories",
  ]);
  await expect(page.getByText("Starts the operation.")).toBeVisible();
  // The browser only ever talks to this app's server, never to a router.
  expect([...hosts]).toEqual([new URL(page.url()).host]);
});

test("[FR-WB-7] reaches the page, runs the example and opens a request, by keyboard alone", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Operations" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Operations" })).toBeVisible();

  await editor(page).focus();
  // Tab must leave the editor, or a keyboard user is stuck in it (ADR 0018).
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: /Variables/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Show route" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("3 requests to 3 subgraphs, in 2 stages.")).toBeVisible();

  await page.getByText("What the router asks repositories").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "The request to repositories" })).toContainText(
    "_entities(representations: $representations)",
  );
});

test("[FR-WB-7] marks a field the graph doesn't have as it's typed, and shows the router's refusal", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);

  await editor(page).fill(`query Bad { package(name: "express") { nope } }`);
  await expect(page.locator(".cm-lintRange-error")).toBeVisible();
  await page.getByRole("button", { name: "Show route" }).click();

  await expect(failure(page)).toContainText('Cannot query field "nope" on type "Package".');
  // The editor's checker and the page must share one copy of graphql, or it throws (W-5).
  expect(errors).toEqual([]);
});

test("[GR-11] refuses a mutation, and says only queries can run", async ({ page }) => {
  await open(page);

  await editor(page).fill(`mutation Write { __typename }`);
  await page.getByRole("button", { name: "Show route" }).click();

  await expect(failure(page)).toContainText("This operation can't run:");
  await expect(failure(page)).toContainText("Only queries can run here");
});

test("asks for a JSON object when the variables aren't one", async ({ page }) => {
  await open(page);

  await page.getByRole("textbox", { name: /Variables/ }).fill("name: express");
  await page.getByRole("button", { name: "Show route" }).click();

  await expect(failure(page)).toContainText("The variables must be a JSON object");
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("[NFR-9] the editor and a route have no WCAG 2.2 AA violations", async ({ page }) => {
      await open(page);
      await showRoute(page);
      await page.getByText("What the router asks packages").click();

      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();

      expect(violations).toEqual([]);
    });

    test("[NFR-9] a marked mistake, its completion list and a refusal have no WCAG 2.2 AA violations", async ({
      page,
    }) => {
      await open(page);
      await editor(page).fill(`query Bad { package(name: "express") { nope } }`);
      await expect(page.locator(".cm-lintRange-error")).toBeVisible();
      await page.getByRole("button", { name: "Show route" }).click();
      await expect(failure(page)).toBeVisible();
      await editor(page).fill(`query Q { package(name: "express") { `);
      await editor(page).press("Control+Space");
      await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible();

      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();

      expect(violations).toEqual([]);
    });
  });
}
