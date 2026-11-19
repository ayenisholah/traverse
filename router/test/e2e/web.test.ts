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
  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  stack = await startStack({ webOrigin: origin });
  sandbox = await stack.startSandbox();
  web = startWebServer(port, {
    PUBLIC_ROUTER_URL: stack.url,
    SANDBOX_ROUTER_URL: sandbox.url,
    APP_ORIGIN: origin,
    AUTH_DOMAIN_URL: stack.auth.domainUrl,
    AUTH_CLIENT_ID: stack.auth.clientId,
    AUTH_CLIENT_SECRET: stack.auth.clientSecret,
    AUTH_RESOURCE: stack.auth.resource,
    SESSION_KEY: Buffer.alloc(32, 4).toString("base64url"),
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

/** Signs in as a browser would: the app, the issuer's form, then back. Returns the cookies. */
const signIn = async (username: string): Promise<string> => {
  const cookies = new Map<string, string>();
  const take = (response: Response) => {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";") as [string];
      const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const header = () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  const start = await fetch(`${web.url}/sign-in`, { redirect: "manual" });
  take(start);
  const authorize = new URL(start.headers.get("location") ?? "");
  const signedIn = await fetch(`${stack.auth.domainUrl}/oauth2/authorize`, {
    method: "POST",
    body: new URLSearchParams({ ...Object.fromEntries(authorize.searchParams), username }),
    redirect: "manual",
  });
  const back = await fetch(signedIn.headers.get("location") ?? "", {
    headers: { cookie: header() },
    redirect: "manual",
  });
  take(back);
  return [...cookies]
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
};

const trpc = async (cookie: string, path: string, input?: unknown, method = "GET") => {
  const url =
    method === "GET" && input !== undefined
      ? `${web.url}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`
      : `${web.url}/api/trpc/${path}`;
  const response = await fetch(url, {
    method,
    headers: { cookie, "content-type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(input) } : {}),
  });
  return {
    status: response.status,
    body: (await response.json()) as { result?: { data: unknown } },
  };
};

describe("saved workspaces, from sign-in to Postgres", { timeout: 60_000 }, () => {
  it("[FR-WB-11] a signed-in user saves a workspace through the web server, and reopens it", async () => {
    const cookie = await signIn("ada");
    const drafts = [{ subgraph: "packages", sdl: "type Query { a: String }" }];
    const saved = await trpc(
      cookie,
      "saveWorkspace",
      { name: "Real", drafts, operations: "query A { a }", screenMap: "S: A" },
      "POST",
    );
    const id = (saved.body.result?.data as { id: string }).id;

    const reopened = await trpc(cookie, "workspace", { id });
    expect(reopened.body.result?.data).toMatchObject({
      id,
      name: "Real",
      drafts,
      screenMap: "S: A",
    });
  });

  it("[FR-SG-1] another user can't see or open it", async () => {
    const ada = await signIn("ada");
    const saved = await trpc(
      ada,
      "saveWorkspace",
      { name: "Ada's", drafts: [], operations: "", screenMap: null },
      "POST",
    );
    const id = (saved.body.result?.data as { id: string }).id;
    const grace = await signIn("grace");

    expect((await trpc(grace, "workspaces")).body.result?.data).toEqual([]);
    expect((await trpc(grace, "workspace", { id })).body.result?.data).toBeNull();
    expect((await trpc(grace, "deleteWorkspace", { id }, "POST")).body.result?.data).toBe(false);
  });

  it("[GR-3] someone signed out gets nothing, whatever they send", async () => {
    const answer = await fetch(`${web.url}/api/trpc/workspaces`, {
      headers: { authorization: `Bearer ${await stack.token({ sub: "ada" })}`, "x-user-id": "ada" },
    });

    expect(answer.status).toBe(401);
  });
});
