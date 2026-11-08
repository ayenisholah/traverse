import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordings as advisories } from "../../../subgraphs/advisories/test/helpers.ts";
import { fixture } from "../../../subgraphs/packages/test/helpers.ts";
import { recordings as repositories } from "../../../subgraphs/repositories/test/helpers.ts";
import { startStack, type Stack } from "../support/stack.ts";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 180_000);

afterAll(async () => {
  await stack.stop();
});

const PACKAGE = readFileSync("router/operations/package.graphql", "utf8");
const sha256 = (body: string) => createHash("sha256").update(body).digest("hex");

interface GraphqlResponse {
  data?: Record<string, unknown> | null;
  errors?: { message: string }[];
  extensions?: Record<string, unknown>;
}

const post = async (
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: GraphqlResponse }> => {
  const response = await fetch(`${stack.url}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: (text ? JSON.parse(text) : {}) as GraphqlResponse };
};

const persisted = (hash: string, variables: Record<string, unknown> = {}) => ({
  variables,
  extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
});

const express = persisted(sha256(PACKAGE), { name: "express" });
const DEEPEST = `query Deepest { package(name: "express") { repository { url } } }`;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("the public router", { timeout: 60_000 }, () => {
  it("[FR-SG-5] joins a package, its repository and its advisories in one operation", async () => {
    const before = await stack.subgraphRequests();
    const { status, json } = await post(express);

    // Proves the counter the "before any subgraph" tests rely on does count real requests.
    expect(await stack.subgraphRequests()).toBeGreaterThan(before);

    expect(status).toBe(200);
    expect(json.errors).toBeUndefined();
    expect(json.data).toEqual({
      package: expect.objectContaining({
        name: "express",
        latestVersion: fixture("express.latest").version,
        repository: {
          url: "https://github.com/expressjs/express",
          stars: repositories.expressjs__express?.data.repository?.stargazerCount,
          owner: "expressjs",
          latestRelease: "v5.3.0",
        },
        advisories: advisories.express?.vulns.map(
          ({ id }) => expect.objectContaining({ id }) as unknown,
        ),
      }) as unknown,
    });
  });

  it("[GR-2] rejects an operation sent as text", async () => {
    const before = await stack.subgraphRequests();
    const { json } = await post({ query: PACKAGE, variables: { name: "express" } });

    expect(json.data ?? null).toBeNull();
    expect(json.errors?.[0]?.message).toBe("non-persisted operation is blocked");
    expect(await stack.subgraphRequests()).toBe(before);
  });

  it("[GR-2] won't let a client register an operation of its own", async () => {
    const query = "query Registered { __typename }";
    const register = await post({ query, ...persisted(sha256(query)) });
    const replay = await post(persisted(sha256(query)));

    expect(register.json.data ?? null).toBeNull();
    expect(replay.json.errors?.[0]?.message).toBe("PersistedQueryNotFound");
  });

  it("[GR-2] rejects a hash it doesn't hold", async () => {
    const { json } = await post(persisted(sha256("query Unknown { __typename }")));

    expect(json.data ?? null).toBeNull();
    expect(json.errors?.[0]?.message).toBe("PersistedQueryNotFound");
  });

  it("[FR-GW-4] rejects a persisted operation over the field limit", async () => {
    const fields = Array.from({ length: 70 }, (_, index) => `f${String(index)}: name`).join(" ");
    const hash = stack.persist(`query Wide { package(name: "express") { ${fields} } }`);
    const before = await stack.subgraphRequests();

    const { json } = await post(persisted(hash));

    expect(json.data ?? null).toBeNull();
    expect(json.errors?.[0]?.message).toMatch(/total number of fields 71 exceeds/);
    expect(await stack.subgraphRequests()).toBe(before);
  });

  it("[FR-GW-4] rejects aliases on root fields, which would multiply upstream calls", async () => {
    const hash = stack.persist(`query Aliased { a: package(name: "ms") { name } }`);

    const { json } = await post(persisted(hash));

    expect(json.errors?.[0]?.message).toMatch(/root field aliases 1 exceeds/);
  });

  it("[FR-GW-4] serves the deepest operation the schema allows", async () => {
    const { json } = await post(persisted(stack.persist(DEEPEST)));

    expect(json.errors).toBeUndefined();
  });

  it("[FR-GW-4] rejects a persisted operation over the depth limit", async () => {
    // Nothing in the schema nests past the public limit, so this router lowers it by one.
    const lowered = await stack.startRouter(
      "security:\n  complexity_limits:\n    depth:\n      enabled: true\n      limit: 2\n",
    );
    try {
      const before = await stack.subgraphRequests();
      const response = await fetch(`${lowered.url}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(persisted(stack.persist(DEEPEST))),
      });
      const json = (await response.json()) as GraphqlResponse;

      expect(json.errors?.[0]?.message).toMatch(/depth 3 exceeds/);
      expect(await stack.subgraphRequests()).toBe(before);
    } finally {
      await lowered.stop();
    }
  });

  it("[FR-GW-4] rejects a body over the size limit", async () => {
    const { status } = await post(JSON.stringify({ ...express, padding: "x".repeat(1_100_000) }));

    expect(status).toBe(413);
  });

  it("[FR-GW-2] serves public data to a request with no token", async () => {
    const { status, json } = await post(express);

    expect(status).toBe(200);
    expect(json.data?.package).not.toBeNull();
  });

  it("[FR-GW-2] serves a valid token", async () => {
    const { status } = await post(express, bearer(await stack.token()));

    expect(status).toBe(200);
  });

  it.each([
    ["expired", { expires: "-1m" }],
    ["for another audience", { audience: "someone-else" }],
  ])("[FR-GW-2] refuses a token that's %s, before any subgraph", async (_, options) => {
    const before = await stack.subgraphRequests();
    const { status } = await post(express, bearer(await stack.token(options)));

    expect(status).toBe(401);
    expect(await stack.subgraphRequests()).toBe(before);
  });

  it("[FR-GW-2] refuses a token signed by another key, before any subgraph", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    const before = await stack.subgraphRequests();
    const { status } = await post(express, bearer(await stack.token({ key: privateKey })));

    expect(status).toBe(401);
    expect(await stack.subgraphRequests()).toBe(before);
  });

  it("[FR-GW-2] refuses a malformed token", async () => {
    const { status } = await post(express, bearer("not-a-token"));

    expect(status).toBe(401);
  });

  it("[FR-SG-6] still serves the package and advisories when GitHub fails", async () => {
    stack.blockGithub(true);
    try {
      const { json } = await post(persisted(sha256(PACKAGE), { name: "ms" }));

      expect(json.data?.package).toEqual(
        expect.objectContaining({
          name: "ms",
          repository: null,
          advisories: expect.any(Array) as unknown,
        }),
      );
      expect(JSON.stringify(json.errors)).toContain("UPSTREAM_UNAVAILABLE");
    } finally {
      stack.blockGithub(false);
    }
  });

  it("[GR-1] refuses introspection, even when persisted", async () => {
    const hash = stack.persist("query Schema { __schema { queryType { name } } }");
    const { json } = await post(persisted(hash));

    expect(json.data?.__schema ?? null).toBeNull();
    expect(json.errors?.[0]?.message).toMatch(/introspection is disabled/);
  });

  it("[GR-1] returns no query plan when asked for one", async () => {
    const { json } = await post(express, { "x-wg-include-query-plan": "true" });

    expect(JSON.stringify(json)).not.toMatch(/queryPlan/i);
  });

  it("[GR-1] serves no playground", async () => {
    const response = await fetch(`${stack.url}/`, { headers: { accept: "text/html" } });

    expect(await response.text()).not.toMatch(/playground|graphiql/i);
  });

  it("[GR-1] allows only the configured origin", async () => {
    const response = await fetch(`${stack.url}/graphql`, {
      method: "OPTIONS",
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "POST",
      },
    });

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
