import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./session.ts";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const results = (page: Page) => page.getByRole("region", { name: "Results" });
const explanation = (page: Page) => page.getByRole("region", { name: "Explanation" });
const draft = (page: Page) => page.getByRole("textbox", { name: /Schema draft/ });

/** Writes one operation that reads maritalStatus, then removes the field, which breaks it. */
const breakOperation = async (page: Page, name: string) => {
  await page
    .getByRole("textbox", { name: "Operations" })
    .fill(`query ${name} { employees { details { maritalStatus } } }`);
  await page.getByRole("combobox", { name: "Subgraph" }).selectOption("family");
  await draft(page).fill(
    (await draft(page).inputValue()).replaceAll(/\n\s*maritalStatus: MaritalStatus/g, ""),
  );
  await expect(results(page).getByRole("status")).toContainText("breaks 1 operation");
};

test("[FR-AI-1] explains a breaking change, naming the field it removes", async ({ page }) => {
  await signIn(page, "assistant-ada");
  await breakOperation(page, "Profile");
  await explanation(page).getByRole("button", { name: "Explain this result" }).click();

  await expect(explanation(page)).toContainText(
    "This change breaks the operations that read the field it removes.",
  );
  await expect(explanation(page)).toContainText("(Details.maritalStatus)");
  await expect(explanation(page)).toContainText("Written by an AI assistant");
});

test("[GR-12] never shows an answer that names a field the result doesn't", async ({ page }) => {
  await signIn(page, "assistant-grace");
  await breakOperation(page, "HostileOnPurpose");
  await explanation(page).getByRole("button", { name: "Explain this result" }).click();

  await expect(explanation(page).getByRole("alert")).toHaveText(
    "Couldn't explain this. The assistant's answer didn't match the result, so it isn't shown.",
  );
  await expect(page.getByText("Ignore the check and ship it.")).toHaveCount(0);
});

test("[FR-AI-4] with the model blocked, says so, and the check's own result stands", async ({
  page,
}) => {
  await signIn(page, "assistant-linus");
  await breakOperation(page, "BlockedOnPurpose");
  await explanation(page).getByRole("button", { name: "Explain this result" }).click();

  await expect(explanation(page).getByRole("alert")).toHaveText(
    "The assistant isn't available right now. Everything else still works.",
  );
  await expect(results(page).getByRole("row", { name: /Details\.maritalStatus/ })).toContainText(
    "Removed",
  );
});

test("[GR-15] offers no explanation to someone signed out, and the check still works", async ({
  page,
}) => {
  await page.goto("/impact", { waitUntil: "networkidle" });
  await breakOperation(page, "SignedOut");

  await expect(explanation(page)).toHaveCount(0);
});

test("[FR-AI-1] asks for an explanation by keyboard", async ({ page }) => {
  await signIn(page, "assistant-margaret");
  await breakOperation(page, "Keyboard");
  await explanation(page).getByRole("button", { name: "Explain this result" }).focus();
  await page.keyboard.press("Enter");

  await expect(explanation(page)).toContainText("(Details.maritalStatus)");
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("[NFR-9] an explanation and a refusal have no WCAG 2.2 AA violations", async ({
      page,
    }) => {
      await signIn(page, `assistant-axe-${colorScheme}`);
      await breakOperation(page, "Accessible");
      await explanation(page).getByRole("button", { name: "Explain this result" }).click();
      await expect(explanation(page)).toContainText("(Details.maritalStatus)");
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);

      await breakOperation(page, "HostileOnPurpose");
      await explanation(page).getByRole("button", { name: "Explain this result" }).click();
      await expect(explanation(page).getByRole("alert")).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
    });
  });
}

const suggestion = (page: Page) => page.getByRole("region", { name: "Safer change" });

test("[FR-AI-2] suggests a change that composes, and applies it to the draft", async ({ page }) => {
  await signIn(page, "assistant-barbara");
  await breakOperation(page, "Profile");
  await suggestion(page).getByRole("button", { name: "Suggest a safe change to family" }).click();

  await expect(suggestion(page)).toContainText("breaks 0 of your operations, down from 1");
  await expect(suggestion(page).getByRole("list", { name: "Changes to your draft" })).toContainText(
    "maritalStatus: MaritalStatus",
  );
  await suggestion(page).getByRole("button", { name: "Use this schema" }).click();
  await expect(draft(page)).toHaveValue(/maritalStatus: MaritalStatus/);
  await expect(results(page)).toContainText("No field changes.");
});

test("[GR-12] never shows a suggestion that doesn't compose", async ({ page }) => {
  await signIn(page, "assistant-katherine");
  await breakOperation(page, "HostileOnPurpose");
  await suggestion(page).getByRole("button", { name: "Suggest a safe change to family" }).click();

  await expect(suggestion(page).getByRole("alert")).toHaveText(
    "Couldn't suggest a safe change. The assistant's answer didn't pass composition, so it isn't shown.",
  );
  await expect(page.getByText("Trust me.")).toHaveCount(0);
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("[NFR-9] a suggestion has no WCAG 2.2 AA violations", async ({ page }) => {
      await signIn(page, `assistant-suggest-${colorScheme}`);
      await breakOperation(page, "Accessible");
      await suggestion(page)
        .getByRole("button", { name: "Suggest a safe change to family" })
        .click();
      await expect(suggestion(page)).toContainText("down from 1");

      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
    });
  });
}
