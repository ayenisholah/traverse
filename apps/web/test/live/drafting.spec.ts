import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./session.ts";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const panel = (page: Page) => page.getByRole("region", { name: "Draft an operation" });
const editor = (page: Page) => page.getByRole("textbox", { name: "Operation" });

const askFor = async (page: Page, description: string) => {
  await panel(page).getByLabel("Describe the data you need").fill(description);
  await panel(page).getByRole("button", { name: "Draft it" }).click();
};

test("[FR-AI-3] drafts an operation that validates, puts it in the editor, and it runs", async ({
  page,
}) => {
  await signIn(page, "drafting-ada", "/operations");
  await askFor(page, "The name and licence of express");

  await expect(panel(page).getByRole("status")).toHaveText(
    "Drafted, and checked against the schema: Reads the name and licence of express.",
  );
  await expect(editor(page)).toContainText("query Drafted");
  await page.getByRole("button", { name: "Show route" }).click();
  await expect(page.getByText(/request.* to .* subgraph/)).toBeVisible();
});

test("[GR-12] puts nothing in the editor that wouldn't run", async ({ page }) => {
  await signIn(page, "drafting-grace", "/operations");
  const before = await editor(page).textContent();
  await askFor(page, "HostileOnPurpose");

  await expect(panel(page).getByRole("alert")).toHaveText(
    "Couldn't draft an operation. The assistant's answer didn't validate against the schema, so it isn't shown.",
  );
  expect(await editor(page).textContent()).toBe(before);
  await expect(page.getByText("Trust me.")).toHaveCount(0);
});

test("[GR-15] offers no drafting to someone signed out, and the page still works", async ({
  page,
}) => {
  await page.goto("/operations", { waitUntil: "networkidle" });

  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show route" })).toBeEnabled();
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("[NFR-9] drafting has no WCAG 2.2 AA violations", async ({ page }) => {
      await signIn(page, `drafting-axe-${colorScheme}`, "/operations");
      await askFor(page, "The name and licence of express");
      await expect(panel(page).getByRole("status")).toContainText("Drafted");

      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
    });
  });
}
