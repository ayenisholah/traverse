import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const bar = (page: Page) => page.getByRole("region", { name: "Workspace" });
const draft = (page: Page) => page.getByRole("textbox", { name: /Schema draft/ });

/** Signs in at the local issuer as `username`, from `from`, and waits to be back. */
const signIn = async (page: Page, username: string, from = "/impact") => {
  await page.goto(from, { waitUntil: "networkidle" });
  await nav(page).getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(nav(page).getByRole("button", { name: "Sign out" })).toBeVisible();
};

const saveDraft = async (page: Page, name: string, sdl: string) => {
  await draft(page).fill(sdl);
  await page.getByRole("textbox", { name: "Screens (optional)" }).fill("Checkout: ExampleQuery");
  await bar(page).getByLabel("Name").fill(name);
  await bar(page).getByRole("button", { name: "Save" }).click();
  await expect(bar(page).getByRole("status")).toHaveText(`Saved “${name}”.`);
};

test("[FR-WB-11] saves a draft and reopens it in a new session", async ({ page, browser }) => {
  const sdl = `type Query { saved${String(Date.now())}: Int }`;
  await signIn(page, "ada");
  await saveDraft(page, "Checkout", sdl);
  await nav(page).getByRole("button", { name: "Sign out" }).click();
  await expect(nav(page).getByRole("link", { name: "Sign in" })).toBeVisible();

  const later = await browser.newContext();
  const again = await later.newPage();
  await signIn(again, "ada", "/workspaces");
  await again.getByRole("link", { name: "Checkout" }).first().click();

  await expect(bar(again).getByRole("status")).toHaveText("Opened “Checkout”.");
  await expect(draft(again)).toHaveValue(sdl);
  await expect(again.getByRole("textbox", { name: "Screens (optional)" })).toHaveValue(
    "Checkout: ExampleQuery",
  );
  await later.close();
});

test("[FR-SG-1] shows one user none of another's workspaces", async ({ page, browser }) => {
  await signIn(page, "grace");
  await saveDraft(page, "Grace's only", "type Query { g: Int }");

  const other = await browser.newContext();
  const linus = await other.newPage();
  await signIn(linus, "linus", "/workspaces");
  await expect(linus.getByText(/No saved workspaces yet/)).toBeVisible();
  await other.close();
});

test("[FR-WB-11] deletes a saved workspace", async ({ page }) => {
  await signIn(page, "barbara");
  await saveDraft(page, "To delete", "type Query { d: Int }");
  await page.goto("/workspaces", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Delete To delete" }).click();

  await expect(page.getByRole("status")).toHaveText("Deleted “To delete”.");
  await expect(page.getByText(/No saved workspaces yet/)).toBeVisible();
});

test("[FR-WB-11] offers sign-in to save, and the impact check works without it", async ({
  page,
}) => {
  await page.goto("/impact", { waitUntil: "networkidle" });

  await expect(bar(page).getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
});

test("[FR-WB-11] saves and opens by keyboard", async ({ page }) => {
  await signIn(page, "margaret");
  await draft(page).fill("type Query { k: Int }");
  await bar(page).getByLabel("Name").fill("Keyboard");
  await page.keyboard.press("Enter");
  await expect(bar(page).getByRole("status")).toHaveText("Saved “Keyboard”.");

  await page.goto("/workspaces", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Keyboard" }).focus();
  await page.keyboard.press("Enter");
  await expect(draft(page)).toHaveValue("type Query { k: Int }");
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("[NFR-9] the workspace bar and the list have no WCAG 2.2 AA violations", async ({
      page,
    }) => {
      await signIn(page, `axe-${colorScheme}`);
      await saveDraft(page, "Accessible", "type Query { x: Int }");
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);

      await page.goto("/workspaces", { waitUntil: "networkidle" });
      await expect(page.getByRole("link", { name: "Accessible" })).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
    });
  });
}
