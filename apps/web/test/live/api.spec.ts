import { expect, test } from "@playwright/test";

test("[FR-WB-12] a page reads live package data through the server, and never from a router", async ({
  page,
}) => {
  const hosts = new Set<string>();
  page.on("request", (request) => hosts.add(new URL(request.url()).host));
  await page.goto("/");

  const body = await page.evaluate(async () => {
    const input = encodeURIComponent(JSON.stringify({ name: "express" }));
    const response = await fetch(`/api/trpc/package?input=${input}`);
    return (await response.json()) as {
      result: { data: { package: { name: string; license: string }; incomplete: boolean } };
    };
  });

  expect(body.result.data).toMatchObject({
    package: { name: "express", license: "MIT" },
    incomplete: false,
  });
  expect([...hosts]).toEqual([new URL(page.url()).host]);
});
