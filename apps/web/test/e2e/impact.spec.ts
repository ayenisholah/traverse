import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page) => {
  await page.goto("/impact", { waitUntil: "networkidle" });
  await expect(page.getByText("The draft composes.")).toBeVisible();
};

// Next adds its own hidden alert for route changes, so this looks inside the page content.
const failure = (page: Page) => page.getByRole("main").getByRole("alert");

const draft = (page: Page) => page.getByRole("textbox", { name: /Schema draft/ });

const editFamily = async (page: Page, edit: (sdl: string) => string) => {
  await page.getByRole("combobox", { name: "Subgraph" }).selectOption("family");
  await draft(page).fill(edit(await draft(page).inputValue()));
};

test("[FR-WB-2] composes the real graph in a Web Worker when the page opens", async ({ page }) => {
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));

  await open(page);

  expect(workers).toHaveLength(1);
  await expect(page.getByText("No field changes.")).toBeVisible();
});

test("[FR-WB-2] shows composition errors from a broken draft", async ({ page }) => {
  await open(page);

  await editFamily(page, (sdl) => `${sdl}\ntype {`);

  await expect(failure(page)).toContainText("This draft doesn't compose");
  await expect(failure(page)).toContainText("Syntax Error");
});

test("[FR-WB-2] shows Cosmo's own error for a draft that can't federate", async ({ page }) => {
  await open(page);

  await page.getByRole("combobox", { name: "Subgraph" }).selectOption("mood");
  await draft(page).fill((await draft(page).inputValue()).replace("currentMood: Mood!", ""));

  await expect(failure(page)).toContainText("currentMood");
});

test("[FR-WB-3] lists the field, the subgraph and the operation a change breaks", async ({
  page,
}) => {
  await open(page);

  await editFamily(page, (sdl) => sdl.replaceAll(/\n\s*maritalStatus: MaritalStatus/g, ""));

  // The server build also has the workspace bar's own status, so this reads the results' one.
  const results = page.getByRole("region", { name: "Results" });
  await expect(results.getByRole("status")).toContainText("breaks 1 operation");
  const row = page.getByRole("row", { name: /Details\.maritalStatus/ });
  await expect(row).toContainText("Removed");
  await expect(row).toContainText("family");
  await expect(page.getByRole("heading", { name: "Operation 1" })).toBeVisible();
  await expect(page.getByText(/Cannot query field "maritalStatus"/)).toBeVisible();
});

test("[FR-WB-3] lists the screens a change breaks", async ({ page }) => {
  await open(page);

  await page.getByRole("textbox", { name: /Screens/ }).fill("Profile: Operation 1");
  await editFamily(page, (sdl) => sdl.replaceAll(/\n\s*maritalStatus: MaritalStatus/g, ""));

  await expect(page.getByRole("heading", { name: "Affected screens" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Screens" })).toContainText("Profile: Operation 1");
});

test("[FR-WB-2] goes back to a clean result when drafts are reset", async ({ page }) => {
  await open(page);
  await editFamily(page, (sdl) => `${sdl}\ntype {`);
  await expect(failure(page)).toBeVisible();

  await page.getByRole("button", { name: "Reset drafts" }).click();

  await expect(page.getByText("No field changes.")).toBeVisible();
});

test("[NFR-12] composing a real graph causes no main-thread task over 200 ms", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const tasks: number[] = [];
    Object.assign(window, { longTasks: tasks });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(entry.duration);
    }).observe({ entryTypes: ["longtask"] });
  });

  for (const round of [1, 2, 3]) {
    await editFamily(page, (sdl) => `${sdl}\n# edit ${round}`);
    await expect(page.getByText("The draft composes.")).toBeVisible();
  }

  const tasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
  expect(tasks.filter((duration) => duration > 200)).toEqual([]);
});

test("[NFR-12] keeps the composer off the map page", async ({ page }) => {
  const sizes: number[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(".js")) {
      void response.body().then((body) => sizes.push(body.length));
    }
  });

  await page.goto("/", { waitUntil: "networkidle" });

  expect(sizes.length).toBeGreaterThan(0);
  expect(Math.max(...sizes)).toBeLessThan(500_000);
});

test("[FR-WB-2] moves between the map and the impact check by keyboard", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  await page.getByRole("link", { name: "Impact check" }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { level: 1, name: "Impact check" })).toBeVisible();
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("[NFR-9] results have no WCAG 2.2 AA violations", async ({ page }) => {
      await open(page);
      await editFamily(page, (sdl) => sdl.replaceAll(/\n\s*maritalStatus: MaritalStatus/g, ""));
      await expect(page.getByRole("heading", { name: "Operation 1" })).toBeVisible();

      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();

      expect(violations).toEqual([]);
    });

    test("[NFR-9] a composition error has no WCAG 2.2 AA violations", async ({ page }) => {
      await open(page);
      await editFamily(page, (sdl) => `${sdl}\ntype {`);
      await expect(failure(page)).toBeVisible();

      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();

      expect(violations).toEqual([]);
    });
  });
}
