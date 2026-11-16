import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const out = join(import.meta.dirname, "../../out");

describe("static export", () => {
  let html: string;

  beforeAll(async () => {
    html = await readFile(join(out, "index.html"), "utf8");
  });

  it("[FR-WB-15] prerenders the page, so it needs no server", () => {
    expect(html).toContain('<html lang="en"');
    expect(html).toContain("<title>Traverse</title>");
    expect(html).toMatch(/<h1[^>]*>Traverse<\/h1>/);
    expect(html).toContain('role="separator"');
  });

  it("[FR-WB-15] holds the map and the impact check only, and no live route or API", () => {
    const pages = readdirSync(out, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".html"))
      .sort();

    expect(pages).toEqual(["404.html", "_not-found.html", "impact.html", "index.html"]);
    expect(readdirSync(out)).not.toContain("api");
  });

  it("[FR-WB-1] prerenders the real graph, so the map shows before any script runs", () => {
    expect(html).toContain("employee-events");
    expect(html).toContain("No owner set");
    expect(html).toContain('id="type-option-Employee"');
  });

  it("[FR-WB-2] exports the impact check as a page of its own", async () => {
    const impact = await readFile(join(out, "impact.html"), "utf8");

    expect(impact).toContain("<title>Impact check · Traverse</title>");
    expect(impact).toContain('id="draft"');
  });

  it("[FR-WB-13] links a stylesheet that holds the page's Tailwind classes", async () => {
    const [, href] = /href="(\/_next\/static\/[^"]+\.css)"/.exec(html) ?? [];

    const css = await readFile(join(out, href ?? "missing"), "utf8");

    expect(css).toContain(".max-w-7xl");
    expect(css).toContain("--canvas:");
    expect(css).toContain("prefers-color-scheme");
    expect(css).not.toContain("--color-red-500");
  });
});
