import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

/** Signs in at the local issuer, which stands in for the user pool's managed login. */
const signIn = async (page: Page, from = "/") => {
  await page.goto(from, { waitUntil: "networkidle" });
  await nav(page).getByRole("link", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Local sign-in" })).toBeVisible();
  await page.getByLabel("Username").fill("ada");
  await page.getByRole("button", { name: "Sign in" }).click();
};

test("[FR-WB-10] signs in with the user pool and comes back to the same page", async ({ page }) => {
  await signIn(page, "/impact");

  await expect(page).toHaveURL(/\/impact$/);
  await expect(nav(page).getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("[GR-9] keeps the session in cookies scripts can't read", async ({ page, context }) => {
  await signIn(page);
  await expect(nav(page).getByRole("button", { name: "Sign out" })).toBeVisible();

  const cookies = await context.cookies();
  expect(cookies.map(({ name }) => name).sort()).toEqual(["traverse-access", "traverse-session"]);
  expect(cookies.every(({ httpOnly, sameSite }) => httpOnly && sameSite === "Lax")).toBe(true);
  expect(await page.evaluate(() => document.cookie)).toBe("");
});

test("[FR-WB-10] signs out, and the session has ended", async ({ page, context }) => {
  await signIn(page);
  await nav(page).getByRole("button", { name: "Sign out" }).click();

  await expect(nav(page).getByRole("link", { name: "Sign in" })).toBeVisible();
  expect(await context.cookies()).toEqual([]);
});

test("[FR-WB-10] keeps the session across a new page, and refreshes it once the access token has gone", async ({
  page,
  context,
}) => {
  await signIn(page);
  await expect(nav(page).getByRole("button", { name: "Sign out" })).toBeVisible();
  await context.clearCookies({ name: "traverse-access" });

  await page.goto("/packages", { waitUntil: "networkidle" });
  await expect(nav(page).getByRole("button", { name: "Sign out" })).toBeVisible();
  expect((await context.cookies()).map(({ name }) => name)).toContain("traverse-access");
});

test("[FR-WB-10] shows one fixed page when sign-in doesn't finish", async ({ page }) => {
  await page.goto("/auth/callback?code=forged&state=forged");

  await expect(page).toHaveURL(/\/auth\/failed$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign-in didn't finish");
});

test("[FR-WB-10] signs in and out by keyboard", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await nav(page).getByRole("link", { name: "Sign in" }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Username").fill("ada");
  await page.keyboard.press("Enter");
  const signOut = nav(page).getByRole("button", { name: "Sign out" });
  await expect(signOut).toBeVisible();

  await signOut.focus();
  await page.keyboard.press("Enter");
  await expect(nav(page).getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("[NFR-9] the nav fits a phone, signed out and signed in", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(nav(page).getByRole("link", { name: "Sign in" })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);

  await signIn(page);
  await expect(nav(page).getByRole("button", { name: "Sign out" })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("[NFR-9] signed out, signed in and a failed sign-in have no WCAG 2.2 AA violations", async ({
      page,
    }) => {
      await page.goto("/", { waitUntil: "networkidle" });
      await expect(nav(page).getByRole("link", { name: "Sign in" })).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);

      await signIn(page);
      await expect(nav(page).getByRole("button", { name: "Sign out" })).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);

      await page.goto("/auth/failed");
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
    });
  });
}
