import { readFileSync } from "node:fs";
import { minVersion } from "semver";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  freePort,
  startWebServer,
  waitUntilReady,
  type WebServer,
} from "../../../apps/web/test/support/live-server.ts";
import { recordings as osv } from "../../../subgraphs/advisories/test/helpers.ts";
import { fixture } from "../../../subgraphs/packages/test/helpers.ts";
import { recordings as repositories } from "../../../subgraphs/repositories/test/helpers.ts";
import { startStack, type Router, type Stack } from "../support/stack.ts";

let stack: Stack;
let sandbox: Router;
let web: WebServer;

// Needs `npm run build:server` first: this runs the built app, as a deployment would.
beforeAll(async () => {
  stack = await startStack();
  sandbox = await stack.startSandbox();
  web = startWebServer(await freePort(), {
    PUBLIC_ROUTER_URL: stack.url,
    SANDBOX_ROUTER_URL: sandbox.url,
  });
  await waitUntilReady(web);
}, 240_000);

afterAll(async () => {
  await web.stop();
  await sandbox.stop();
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

interface PlanNode {
  kind: string;
  fetch?: { subgraphName: string; fetchId: number };
  children?: PlanNode[];
}

interface RouteBody {
  result: {
    data: {
      kind: string;
      messages?: string[];
      route?: { steps: { id: number; subgraph: string; stage: number; after: number[] }[] };
    };
  };
}

const askRoute = async (operation: string, variables: Record<string, unknown> = {}) => {
  const response = await fetch(`${web.url}/api/trpc/route`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, variables }),
  });
  return { text: await response.clone().text(), body: (await response.json()) as RouteBody };
};

describe("the route view's server on the sandbox router", { timeout: 60_000 }, () => {
  // The shipped Package operation, written out so no file contents are sent in a request. The
  // first test proves it is the file, byte for byte.
  const operation = `query Package($name: String!, $version: String) {
  package(name: $name) {
    name
    latestVersion
    license
    weeklyDownloads
    repositoryUrl
    repository {
      url
      stars
      owner
      latestRelease
    }
    advisories(version: $version) {
      id
      summary
      severity
      fixedIn
    }
  }
}
`;

  it("[FR-WB-7] uses the shipped Package operation", () => {
    expect(readFileSync("router/operations/package.graphql", "utf8")).toBe(operation);
  });

  it("[FR-WB-7] returns the subgraphs and fetch order of the plan the router gives for Package", async () => {
    const direct = await fetch(`${sandbox.url}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: operation, variables: { name: "express" } }),
    });
    const { extensions } = (await direct.json()) as { extensions: { queryPlan: PlanNode } };
    const plan = extensions.queryPlan;
    // Read straight off the router's plan: a sequence of packages, then the other two together.
    const [first, second] = plan.children ?? [];
    const together = (second?.children ?? []).map((child) => child.fetch?.subgraphName);

    const { body } = await askRoute(operation, { name: "express" });
    const steps = body.result.data.route?.steps ?? [];

    expect(plan.kind).toBe("Sequence");
    expect(second?.kind).toBe("Parallel");
    expect(steps.filter(({ stage }) => stage === 0).map(({ subgraph }) => subgraph)).toEqual([
      first?.fetch?.subgraphName,
    ]);
    expect(steps.filter(({ stage }) => stage === 1).map(({ subgraph }) => subgraph)).toEqual(
      together,
    );
    expect(steps.map(({ subgraph }) => subgraph)).toEqual([
      "packages",
      "repositories",
      "advisories",
    ]);
    expect(steps.slice(1).map(({ after }) => after)).toEqual([[0], [0]]);
  });

  it("[GR-16] returns the route and none of the package's data", async () => {
    const { text } = await askRoute(operation, { name: "express" });

    expect(text).toContain('"subgraph":"packages"');
    expect(text).not.toMatch(/GHSA|expressjs\/express|"MIT"/);
  });

  it("[GR-13] passes on nothing a subgraph says when GitHub is down, and still returns the route", async () => {
    stack.blockGithub(true);
    try {
      const { body, text } = await askRoute(operation, { name: "ms" });

      expect(body.result.data.kind).toBe("route");
      expect(text).not.toMatch(/UPSTREAM|unavailable|repositories'/i);
    } finally {
      stack.blockGithub(false);
    }
  });

  it("[FR-WB-7] passes on the router's refusal of an operation over a limit", async () => {
    const { body } = await askRoute(
      `{ a: package(name: "express") { name } b: package(name: "ms") { name } }`,
    );

    expect(body.result.data.kind).toBe("refused");
    expect(body.result.data.messages?.join(" ")).toMatch(/alias/i);
  });

  it("[FR-WB-7] passes on the router's reason for refusing an operation", async () => {
    const unknown = await askRoute(`query Bad { package(name: "express") { nope } }`);
    const write = await askRoute(`mutation Write { __typename }`);
    const subscription = await askRoute(`subscription Watch { __typename }`);

    expect(unknown.body.result.data).toEqual({
      kind: "refused",
      messages: ['Cannot query field "nope" on type "Package".'],
    });
    expect(write.body.result.data.kind).toBe("refused");
    expect(subscription.body.result.data.kind).toBe("refused");
  });
});

interface CheckedDependency {
  name: string;
  range: string;
  status: string;
  version?: string;
  license?: string | null;
  advisories?: { id: string }[] | null;
}

// The two manifests, written out so no file contents are sent in a request. The first test
// proves each is its fixture, byte for byte.
const REAL = {
  name: "@traverse/subgraph-kit",
  version: "0.0.0",
  private: true,
  dependencies: {
    "@apollo/subgraph": "2.15.1",
    graphql: "^16.15.0",
    "graphql-yoga": "6.0.1",
    ioredis: "6.0.0",
    jose: "6.2.15",
    pino: "10.4.0",
    zod: "^4.0.0",
  },
};
const WITH_ADVISORIES = {
  name: "advisory-example",
  dependencies: {
    lodash: "4.17.20",
    ms: "^2.1.3",
  },
};

const check = async (manifest: object) => {
  const response = await fetch(`${web.url}/api/trpc/checkManifest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ manifest: JSON.stringify(manifest) }),
  });
  const { result } = (await response.json()) as {
    result: { data: { kind: string; dependencies: CheckedDependency[] } };
  };
  return result.data;
};

describe("the package.json check on the real graph", { timeout: 60_000 }, () => {
  it("[FR-WB-9] checks the fixtures, unchanged", () => {
    const read = (name: string) =>
      JSON.parse(readFileSync(`apps/web/test/fixtures/${name}`, "utf8")) as unknown;

    expect(read("manifest-subgraph-kit.json")).toEqual(REAL);
    expect(read("manifest-with-advisories.json")).toEqual(WITH_ADVISORIES);
  });

  it.each([
    ["a real project's package.json", REAL],
    ["a package.json with a vulnerable pin", WITH_ADVISORIES],
  ])(
    "[FR-WB-9] shows licences and advisories that match npm and OSV, for %s",
    async (_, manifest) => {
      const answer = await check(manifest);

      expect(answer.kind).toBe("checked");
      expect(answer.dependencies.map(({ name }) => name)).toEqual(
        Object.keys(manifest.dependencies),
      );
      for (const dependency of answer.dependencies) {
        const version = String(minVersion(dependency.range));
        const npm = fixture(`${dependency.name.replaceAll("/", "__")}.latest`);
        const recorded = osv[`${dependency.name}@${version}`];
        // Each query must be recorded, or the stand-in answers "no advisories" and this proves nothing.
        expect(recorded, `${dependency.name}@${version} is recorded`).toBeDefined();

        expect(dependency).toMatchObject({ status: "checked", version, license: npm.license });
        expect(dependency.advisories?.map(({ id }) => id).sort()).toEqual(
          recorded?.vulns.map(({ id }) => id).sort(),
        );
      }
    },
  );

  it("[FR-WB-9] finds the real advisory a real range allows: zod below 4.6.6", async () => {
    const answer = await check(REAL);
    const zod = answer.dependencies.find(({ name }) => name === "zod");

    expect(zod?.version).toBe("4.0.0");
    expect(zod?.advisories?.map(({ id }) => id)).toEqual(["GHSA-mrhx-c7xc-m3w5"]);
  });

  it("[FR-WB-8] serves a package's page from the real graph", async () => {
    const response = await fetch(
      `${web.url}/api/trpc/packagePage?input=${encodeURIComponent(JSON.stringify({ name: "express" }))}`,
    );
    const { result } = (await response.json()) as {
      result: { data: { kind: string; package: { latestVersion: string; advisories: unknown[] } } };
    };

    expect(result.data.kind).toBe("found");
    expect(result.data.package.latestVersion).toBe(fixture("express.latest").version);
    expect(result.data.package.advisories).toHaveLength(osv.express?.vulns.length ?? -1);
  });
});
