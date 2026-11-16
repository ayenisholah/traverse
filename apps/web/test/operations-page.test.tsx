import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import OperationsPage, { metadata } from "../src/app/operations/page.live.tsx";
import { expectNoAxeViolations } from "./axe.ts";

it("[FR-WB-7] offers an editor with a working example, and says what running it does", async () => {
  const { container } = render(<OperationsPage />);

  expect(metadata.title).toBe("Operations · Traverse");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Operations");
  expect(screen.getByRole("textbox", { name: "Operation" }).textContent).toContain(
    "package(name: $name)",
  );
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: /Variables/ }).value).toBe(
    '{ "name": "express" }',
  );
  expect(screen.getByText(/only its route comes back/)).toBeTruthy();
  await expectNoAxeViolations(container);
});
