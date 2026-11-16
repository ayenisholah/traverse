import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  freePort,
  startWebServer,
  waitUntilReady,
  type WebServer,
} from "../../../apps/web/test/support/live-server.ts";
import { fixture } from "../../../subgraphs/packages/test/helpers.ts";
import { recordings as repositories } from "../../../subgraphs/repositories/test/helpers.ts";
import { startStack, type Stack } from "../support/stack.ts";

let stack: Stack;
let web: WebServer;

// Needs `npm run build:server` first: this runs the built app, as a deployment would.
beforeAll(async () => {
  stack = await startStack();
  web = startWebServer(await freePort(), { PUBLIC_ROUTER_URL: stack.url });
  await waitUntilReady(web);
}, 240_000);

afterAll(async () => {
  await web.stop();
  await stack.stop();
});

interface PackageAnswer {
  result: {
    data: {
      package: { name: string; latestVersion: string; repository: unknown; advisories: unknown[] };
      incomplete: boolean;
    };
  };
}

const call = async (input: unknown) => {
  const query = encodeURIComponent(JSON.stringify(input));
  const response = await fetch(`${web.url}/api/trpc/package?input=${query}`);
  return { status: response.status, body: (await response.json()) as PackageAnswer };
};

describe("the web server on the public router", { timeout: 60_000 }, () => {
  it("[FR-WB-12] runs its generated operation on the pinned router, which holds it by the same hash", async () => {
    const { status, body } = await call({ name: "express" });

    expect(status).toBe(200);
    expect(body.result.data.incomplete).toBe(false);
    expect(body.result.data.package).toMatchObject({
      name: "express",
      latestVersion: fixture("express.latest").version,
      repository: {
        url: "https://github.com/expressjs/express",
        stars: repositories.expressjs__express?.data.repository?.stargazerCount,
      },
    });
    expect(body.result.data.package.advisories.length).toBeGreaterThan(0);
  });

  it("[FR-SG-6] says the answer is incomplete when GitHub is down, and still returns the package", async () => {
    stack.blockGithub(true);
    try {
      const { status, body } = await call({ name: "ms" });

      expect(status).toBe(200);
      expect(body.result.data).toMatchObject({
        package: { name: "ms", repository: null },
        incomplete: true,
      });
    } finally {
      stack.blockGithub(false);
    }
  });
});
