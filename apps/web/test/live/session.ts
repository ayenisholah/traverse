import { expect, type Page } from "@playwright/test";

export const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

/** Signs in at the local issuer as `username`, from `from`, and waits to be back. */
export const signIn = async (page: Page, username: string, from = "/impact") => {
  await page.goto(from, { waitUntil: "networkidle" });
  await nav(page).getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(nav(page).getByRole("button", { name: "Sign out" })).toBeVisible();
};
