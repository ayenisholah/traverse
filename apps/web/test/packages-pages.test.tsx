import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PackagePage, { generateMetadata } from "../src/app/packages/[...name]/page.live.tsx";
import PackagesPage, { metadata } from "../src/app/packages/page.live.tsx";
import { expectNoAxeViolations } from "./axe.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/packages/package-explorer.tsx", () => ({
  PackageExplorer: ({ name }: { name: string }) => <p>Explorer for {name}</p>,
}));

const params = (name: string[]) => ({ params: Promise.resolve({ name }) });

describe("the packages pages", () => {
  it("[FR-WB-9] offers a package search and the package.json check", async () => {
    const { container } = render(<PackagesPage />);

    expect(metadata.title).toBe("Packages · Traverse");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Packages");
    expect(screen.getByRole("textbox", { name: "Package name" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "package.json" })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("[FR-WB-8] shows a scoped package's page from its address", async () => {
    render(await PackagePage(params(["%40types", "ms"])));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("@types/ms");
    expect(screen.getByText("Explorer for @types/ms")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All packages" }).getAttribute("href")).toBe(
      "/packages",
    );
    expect(await generateMetadata(params(["%40types", "ms"]))).toEqual({
      title: "@types/ms · Traverse",
    });
  });

  it.each([
    ["a name npm couldn't have", ["..", "etc"]],
    ["a malformed address", ["%E0%A4%A"]],
  ])("[GR-13] loads nothing for %s", async (_, name) => {
    render(await PackagePage(params(name)));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Not a package name");
    expect(screen.queryByText(/Explorer for/)).toBeNull();
    expect(await generateMetadata(params(name))).toEqual({ title: "Package · Traverse" });
  });
});
