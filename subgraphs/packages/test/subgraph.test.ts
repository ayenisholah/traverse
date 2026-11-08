import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composeGraph, findFieldOwners } from "@traverse/graph-core";
import { findPersonalData } from "@traverse/repo-checks";
import type { Subgraph } from "@traverse/subgraph-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectEntrypointToRun } from "../../../packages/subgraph-kit/test/support/run-subgraph.ts";
import { checkNpm } from "../src/live-check.ts";
import { createPackagesSubgraph } from "../src/subgraph.ts";
import { fixture, recordingsFile, replay } from "./helpers.ts";

const PLANTED = "planted.person@example.org";
const ALL_FIELDS = `
  name latestVersion versions license weeklyDownloads repositoryUrl
  dependencies { name range }
`;

interface Result {
  data?: { package?: Record<string, unknown> | null } & Record<string, unknown>;
  errors?: { message: string; extensions?: Record<string, unknown>; path?: string[] }[];
}

let running: Subgraph | undefined;

afterEach(async () => {
  await running?.shutdown();
  running = undefined;
  vi.unstubAllEnvs();
});

const start = async (upstream: typeof fetch, logs: string[] = []) => {
  running = createPackagesSubgraph({
    fetch: upstream,
    env: { PORT: "0", SHUTDOWN_DRAIN_MS: "0" },
    sleep: () => Promise.resolve(),
    logStream: { write: (line: string) => void logs.push(line) },
  });
  return `http://127.0.0.1:${await running.listen()}/graphql`;
};

const post = async (url: string, query: string, variables: object = {}): Promise<Result> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return (await response.json()) as Result;
};

const packageQuery = `query Q($name: String!) { package(name: $name) { ${ALL_FIELDS} } }`;

const fromRecordings: typeof fetch = (input) => Promise.resolve(replay(input as string));

describe("the packages subgraph", () => {
  it("[FR-SG-2] matches the recorded npm responses", async () => {
    const url = await start(fromRecordings);
    const latest = fixture("express.latest") as {
      version: string;
      license: string;
      dependencies: Record<string, string>;
    };

    const { data, errors } = await post(url, packageQuery, { name: "express" });

    expect(errors).toBeUndefined();
    expect(data?.package).toEqual({
      name: "express",
      latestVersion: latest.version,
      license: latest.license,
      repositoryUrl: "https://github.com/expressjs/express",
      weeklyDownloads: fixture("express.downloads").downloads,
      versions: Object.keys(fixture("express.versions").versions as object),
      dependencies: Object.entries(latest.dependencies).map(([name, range]) => ({ name, range })),
    });
  });

  it("[FR-SG-2] serves a scoped package", async () => {
    const url = await start(fromRecordings);

    const { data } = await post(url, packageQuery, { name: "@types/ms" });

    expect(data?.package).toMatchObject({
      name: "@types/ms",
      weeklyDownloads: fixture("@types__ms.downloads").downloads,
    });
  });

  it("[FR-SG-2] returns null for a package that doesn't exist", async () => {
    const url = await start(fromRecordings);

    const { data, errors } = await post(url, packageQuery, { name: "no-such-package" });

    expect(data?.package).toBeNull();
    expect(errors).toBeUndefined();
  });

  it.each(["../../admin", "a/b/c", "UPPER space", "", "@scope", "%2e%2e/x"])(
    "[FR-SG-2] refuses the name %j without calling npm",
    async (name) => {
      const upstream = vi.fn<typeof fetch>();
      const url = await start(upstream);

      const { data } = await post(url, packageQuery, { name });

      expect(data?.package).toBeNull();
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it("[FR-SG-2] fetches versions and downloads only when asked", async () => {
    const upstream = vi.fn<typeof fetch>(fromRecordings);
    const url = await start(upstream);

    await post(url, `{ package(name: "ms") { name latestVersion } }`);

    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0]?.[0] as string).toContain("/ms/latest");
  });

  it("[FR-SG-2] asks npm for the small version document", async () => {
    const upstream = vi.fn<typeof fetch>(fromRecordings);
    const url = await start(upstream);

    await post(url, `{ package(name: "ms") { versions } }`);

    const request = upstream.mock.calls.find(([input]) => !(input as string).endsWith("/latest"));
    expect(request?.[1]?.headers).toMatchObject({
      accept: "application/vnd.npm.install-v1+json",
    });
  });

  it("[FR-SG-2] resolves a package as an entity", async () => {
    const url = await start(fromRecordings);

    const { data } = await post(
      url,
      `{ _entities(representations: [{ __typename: "Package", name: "ms" }]) {
        ... on Package { latestVersion }
      } }`,
    );

    expect(data?._entities).toEqual([{ latestVersion: fixture("ms.latest").version }]);
  });

  it.each([{}, { name: null }, { name: ["ms"] }, { name: "../../admin" }, { name: "a/b/c" }])(
    "[FR-SG-2] resolves the entity %j to null, without calling npm",
    async (representation) => {
      const upstream = vi.fn<typeof fetch>();
      const logs: string[] = [];
      const url = await start(upstream, logs);

      const { data } = await post(
        url,
        `query Q($r: [_Any!]!) { _entities(representations: $r) { ... on Package { name } } }`,
        { r: [{ __typename: "Package", ...representation }] },
      );

      expect(data?._entities).toEqual([null]);
      expect(upstream).not.toHaveBeenCalled();
      expect(logs.join("\n")).not.toContain("resolver failed");
    },
  );

  it("[FR-SG-2] reads an old-style licence object", async () => {
    const legacy = { ...fixture("ms.latest"), license: { type: "BSD-3-Clause", url: "x" } };
    const url = await start(() => Promise.resolve(Response.json(legacy)));

    const { data } = await post(url, `{ package(name: "ms") { license } }`);

    expect(data?.package?.license).toBe("BSD-3-Clause");
  });

  it("[FR-SG-2] allows a package with no licence, repository or dependencies", async () => {
    const url = await start(() => Promise.resolve(Response.json({ version: "1.0.0" })));

    const { data, errors } = await post(
      url,
      `{ package(name: "ms") { license repositoryUrl dependencies { name } } }`,
    );

    expect(errors).toBeUndefined();
    expect(data?.package).toEqual({ license: null, repositoryUrl: null, dependencies: [] });
  });

  it("[FR-SG-2] reads a repository given as a plain string", async () => {
    const body = { version: "1.0.0", repository: "github:owner/repo" };
    const url = await start(() => Promise.resolve(Response.json(body)));

    const { data } = await post(url, `{ package(name: "ms") { repositoryUrl } }`);

    expect(data?.package?.repositoryUrl).toBe("https://github.com/owner/repo");
  });
});

describe("failures", () => {
  const failing =
    (matches: string): typeof fetch =>
    (input) =>
      (input as string).includes(matches)
        ? Promise.resolve(new Response("{}", { status: 503 }))
        : fromRecordings(input);

  it("[FR-SG-6] keeps the package when only the downloads API fails", async () => {
    const url = await start(failing("/downloads/"));

    const { data, errors } = await post(url, `{ package(name: "ms") { name weeklyDownloads } }`);

    expect(data?.package).toEqual({ name: "ms", weeklyDownloads: null });
    expect(errors?.[0]).toMatchObject({
      message: "npm downloads is unavailable.",
      extensions: { code: "UPSTREAM_UNAVAILABLE" },
    });
  });

  it("[FR-SG-2] gives no downloads for a package the API doesn't know", async () => {
    const url = await start((input) =>
      (input as string).includes("/downloads/")
        ? Promise.resolve(new Response("{}", { status: 404 }))
        : fromRecordings(input),
    );

    const { data, errors } = await post(url, `{ package(name: "ms") { weeklyDownloads } }`);

    expect(data?.package?.weeklyDownloads).toBeNull();
    expect(errors).toBeUndefined();
  });

  it("[FR-SG-2] gives no versions if the package vanishes between two calls", async () => {
    const url = await start((input) =>
      (input as string).endsWith("/ms")
        ? Promise.resolve(new Response("{}", { status: 404 }))
        : fromRecordings(input),
    );

    const { data } = await post(url, `{ package(name: "ms") { versions } }`);

    expect(data?.package?.versions).toBeNull();
  });

  it("[FR-SG-6] keeps the package when only the slow version document fails", async () => {
    const url = await start((input) =>
      (input as string).endsWith("/ms")
        ? Promise.resolve(new Response("{}", { status: 503 }))
        : fromRecordings(input),
    );

    const { data, errors } = await post(url, `{ package(name: "ms") { latestVersion versions } }`);

    expect(data?.package).toEqual({
      latestVersion: fixture("ms.latest").version,
      versions: null,
    });
    expect(errors?.[0]?.extensions).toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("[FR-SG-6] reports a clear error when the registry fails", async () => {
    const url = await start(failing("/latest"));

    const { data, errors } = await post(url, packageQuery, { name: "ms" });

    expect(data?.package).toBeNull();
    expect(errors?.[0]?.extensions).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", source: "npm" });
  });
});

describe("personal data", () => {
  const withEmails = (body: Record<string, unknown>) => ({
    ...body,
    author: { name: "Someone", email: PLANTED },
    contributors: [{ name: "Someone", email: PLANTED }],
    maintainers: [{ name: "someone", email: PLANTED }],
    _npmUser: { name: "someone", email: PLANTED },
    bugs: { email: PLANTED },
  });

  it("[GR-16] returns no maintainer email from a real response, in data or logs", async () => {
    const logs: string[] = [];
    const url = await start((input) => {
      const answer = replay(input as string);
      return answer.json().then((body) => Response.json(withEmails(body as never)));
    }, logs);

    const result = await post(url, packageQuery, { name: "ms" });

    expect(result.data?.package).toMatchObject({ name: "ms" });
    expect(JSON.stringify(result)).not.toContain(PLANTED);
    expect(logs.join("\n")).not.toContain(PLANTED);
  });

  it("[GR-16] keeps a planted address out of every field, end to end", async () => {
    const body = {
      version: "1.0.0",
      license: `SEE LICENSE IN ${PLANTED}`,
      repository: `https://github.com/${PLANTED}/repo`,
      dependencies: { [PLANTED]: "^1.0.0", a: `git+ssh://${PLANTED}/x` },
      versions: { "1.0.0": { _npmUser: { email: PLANTED } } },
      downloads: 1,
    };
    const logs: string[] = [];
    const url = await start(() => Promise.resolve(Response.json(body)), logs);

    const result = await post(url, packageQuery, { name: "ms" });

    expect(result.errors).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(PLANTED);
    expect(logs.join("\n")).not.toContain(PLANTED);
  });

  it("[GR-16] has no field that could carry an email", () => {
    const sdl = readFileSync(join(import.meta.dirname, "../schema.graphqls"), "utf8");

    expect(sdl).not.toMatch(/email|maintainer|author|contributor/i);
  });

  it("[GR-16] keeps recordings free of personal data", () => {
    expect(findPersonalData(readFileSync(recordingsFile, "utf8"))).toEqual([]);
  });
});

describe("contract", () => {
  it("[FR-SG-2] composes with Cosmo, with Package as an entity", () => {
    const sdl = readFileSync(join(import.meta.dirname, "../schema.graphqls"), "utf8");

    const graph = composeGraph([{ name: "packages", sdl }]);

    expect(graph.success).toBe(true);
    if (graph.success) {
      expect(graph.types.get("Package")?.isEntity).toBe(true);
      expect(findFieldOwners(graph, "Package.versions")).toEqual([{ name: "packages" }]);
    }
  });
});

describe("configuration", () => {
  it.each(["not a url", "http://registry.npmjs.org", "https://evil.example"])(
    "[FR-SG-2] refuses the address %s before it starts",
    (NPM_REGISTRY_URL) => {
      expect(() => createPackagesSubgraph({ env: { NPM_REGISTRY_URL } })).toThrow(
        /NPM_REGISTRY_URL/,
      );
    },
  );

  it("[FR-SG-2] calls the real services by default", async () => {
    const realFetch = globalThis.fetch;
    const upstream = vi.fn<typeof fetch>((input, init) =>
      (input as string).startsWith("http://127.0.0.1")
        ? realFetch(input, init)
        : fromRecordings(input),
    );
    vi.stubGlobal("fetch", upstream);
    running = createPackagesSubgraph({ env: { PORT: "0", SHUTDOWN_DRAIN_MS: "0" } });
    const url = `http://127.0.0.1:${await running.listen()}/graphql`;

    await post(url, `{ package(name: "ms") { weeklyDownloads } }`);

    vi.unstubAllGlobals();
    const called = upstream.mock.calls.map(([input]) => input as string);
    expect(called).toContain("https://registry.npmjs.org/ms/latest");
    expect(called).toContain("https://api.npmjs.org/downloads/point/last-week/ms");
  });
});

describe("the entrypoint", () => {
  it("[FR-SG-2] starts the subgraph, and stops on SIGTERM", async () => {
    vi.stubEnv("PORT", "0");
    vi.stubEnv("SHUTDOWN_DRAIN_MS", "0");

    await expectEntrypointToRun(() => import("../src/main.ts"));
  });
});

describe("the live check", () => {
  it("[FR-SG-10] passes when npm answers as recorded", async () => {
    expect(await checkNpm(fromRecordings)).toEqual([]);
  });

  it("[FR-SG-10] names each check that fails", async () => {
    const failing: typeof fetch = () => Promise.resolve(new Response("{}", { status: 404 }));

    expect(await checkNpm(failing)).toEqual([
      "npm latest: unexpected answer",
      "npm versions: unexpected answer",
      "npm downloads: unexpected answer",
    ]);
  });
});
