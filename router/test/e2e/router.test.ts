import { createHash } from "node:crypto";
import { generateKeyPair } from "jose";
import {
  DeleteWorkspaceOperation,
  PackageOperation,
  SaveWorkspaceOperation,
  WorkspaceOperation,
  WorkspacesOperation,
} from "../../../apps/web/src/generated/operations.ts";
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

// The shipped Package operation, by the hash the app sends (C-34). router/test/config.test.ts
// proves the generated hash and the persisted file both come from router/operations.
const PACKAGE_HASH = PackageOperation.sha256;
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

const express = persisted(PACKAGE_HASH, { name: "express" });
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
    const { json } = await post({
      query: `query AsText { package(name: "express") { name } }`,
    });

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

  it("[GR-4] keeps a GET's operation and variables out of its log", async () => {
    // A second router, because this one's log is the only thing the test reads. The override
    // repeats a setting the file already has, so the config is the shipped one.
    const watched = await stack.startRouter("log_level: info\n");
    try {
      const query = encodeURIComponent(
        `query Sentinel { package(name: "planted-in-query") { name } }`,
      );
      const variables = encodeURIComponent(JSON.stringify({ secret: "planted-in-variables" }));
      const response = await fetch(`${watched.url}/graphql?query=${query}&variables=${variables}`);
      await response.text();
      // The access log line is written just after the answer.
      await new Promise((done) => setTimeout(done, 500));

      expect(watched.logs()).toContain('"path":"/graphql"');
      expect(watched.logs()).not.toMatch(/planted-in-query|planted-in-variables|Sentinel/);
    } finally {
      await watched.stop();
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
      const { json } = await post(persisted(PACKAGE_HASH, { name: "ms" }));

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

/** The subgraph's own message, which the router wraps in its default mode (C-57). */
const subgraphMessage = (json: GraphqlResponse) =>
  (json.errors?.[0] as { extensions?: { errors?: { message: string }[] } } | undefined)?.extensions
    ?.errors?.[0]?.message;

describe("workspaces through the public router", { timeout: 60_000 }, () => {
  const drafts = [{ subgraph: "packages", sdl: "type Query { a: String }" }];
  const saveAs = async (sub: string, name: string, id?: string) =>
    post(
      persisted(SaveWorkspaceOperation.sha256, { id, name, drafts, operations: "query A { a }" }),
      bearer(await stack.token({ sub })),
    );

  it("[FR-WB-11] saves, lists, reopens and deletes a signed-in user's workspace", async () => {
    const { json: saved } = await saveAs("ada", "Checkout");
    const id = (saved.data?.saveWorkspace as { id: string }).id;
    const ada = bearer(await stack.token({ sub: "ada" }));

    const { json: list } = await post(persisted(WorkspacesOperation.sha256), ada);
    expect(list.data?.workspaces).toEqual([expect.objectContaining({ id, name: "Checkout" })]);
    const { json: one } = await post(persisted(WorkspaceOperation.sha256, { id }), ada);
    expect(one.data?.workspace).toMatchObject({ id, drafts, operations: "query A { a }" });
    const { json: gone } = await post(persisted(DeleteWorkspaceOperation.sha256, { id }), ada);
    expect(gone.data).toEqual({ deleteWorkspace: true });
  });

  it("[FR-SG-1] one user reaches no part of another's workspace through any operation", async () => {
    const { json: saved } = await saveAs("ada", "Private");
    const id = (saved.data?.saveWorkspace as { id: string }).id;
    const grace = bearer(await stack.token({ sub: "grace" }));

    const { json: list } = await post(persisted(WorkspacesOperation.sha256), grace);
    expect(list.data?.workspaces).toEqual([]);
    const { json: one } = await post(persisted(WorkspaceOperation.sha256, { id }), grace);
    expect(one.data?.workspace).toBeNull();
    const { json: taken } = await saveAs("grace", "Taken", id);
    expect(subgraphMessage(taken)).toBe("No such workspace.");
    const { json: deleted } = await post(persisted(DeleteWorkspaceOperation.sha256, { id }), grace);
    expect(deleted.data).toEqual({ deleteWorkspace: false });

    const ada = bearer(await stack.token({ sub: "ada" }));
    const { json: still } = await post(persisted(WorkspaceOperation.sha256, { id }), ada);
    expect(still.data?.workspace).toMatchObject({ id, name: "Private" });
  });

  it("[GR-3] a forged user header has no effect, with or without a token", async () => {
    const { json: saved } = await saveAs("ada", "Forged");
    const id = (saved.data?.saveWorkspace as { id: string }).id;

    const { json: anonymous } = await post(persisted(WorkspaceOperation.sha256, { id }), {
      "x-user-id": "ada",
      "x-forwarded-user": "ada",
    });
    expect(subgraphMessage(anonymous)).toBe("Sign in first.");
    const { json: other } = await post(persisted(WorkspaceOperation.sha256, { id }), {
      ...bearer(await stack.token({ sub: "grace" })),
      "x-user-id": "ada",
    });
    expect(other.data?.workspace).toBeNull();
  });

  it("[GR-3] refuses every workspace operation with no token, and a bad one before any subgraph", async () => {
    for (const body of [
      persisted(WorkspacesOperation.sha256),
      persisted(SaveWorkspaceOperation.sha256, { name: "x", drafts, operations: "" }),
    ]) {
      const { json } = await post(body);
      expect(subgraphMessage(json)).toBe("Sign in first.");
    }
    const before = await stack.subgraphRequests();
    const idToken = await stack.token({ sub: "ada", audience: "traverse-web" });
    const { status } = await post(persisted(WorkspacesOperation.sha256), bearer(idToken));

    expect(status).toBe(401);
    expect(await stack.subgraphRequests()).toBe(before);
  });

  it("[GR-11] the sandbox router, on the real graph, reads no workspace and runs no workspace mutation", async () => {
    const { json: saved } = await saveAs("ada", "Not for the sandbox");
    const id = (saved.data?.saveWorkspace as { id: string }).id;
    const sandbox = await stack.startSandbox();
    try {
      const ask = async (query: string) => {
        const response = await fetch(`${sandbox.url}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query }),
        });
        return (await response.json()) as GraphqlResponse;
      };

      expect(subgraphMessage(await ask("{ workspaces { id name } }"))).toBe("Sign in first.");
      const deleted = await ask(`mutation { deleteWorkspace(id: "${id}") }`);
      expect(deleted.errors?.[0]?.message).toBe("operation type 'mutation' is blocked");
    } finally {
      await sandbox.stop();
    }
    const ada = bearer(await stack.token({ sub: "ada" }));
    const { json: still } = await post(persisted(WorkspaceOperation.sha256, { id }), ada);
    expect(still.data?.workspace).toMatchObject({ id });
  });
});
