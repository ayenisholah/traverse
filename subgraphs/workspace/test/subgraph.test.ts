import { EventEmitter } from "node:events";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { expectEntrypointToRun } from "../../../packages/subgraph-kit/test/support/run-subgraph.ts";
import { MAX_WORKSPACES } from "../src/limits.ts";
import { createDatabasePool, createWorkspaceSubgraph } from "../src/subgraph.ts";
import type { Subgraph } from "@traverse/subgraph-kit";
import { createMemoryStore } from "./support/memory-store.ts";

const ISSUER = "https://issuer.example";
const AUDIENCE = "https://router.traverse.test";
const env = {
  PORT: "0",
  SHUTDOWN_DRAIN_MS: "0",
  SHUTDOWN_CLOSE_MS: "50",
  JWKS_URL: "http://keys/jwks.json",
  JWT_AUDIENCE: AUDIENCE,
  JWT_ISSUER: ISSUER,
};

let keys: { privateKey: CryptoKey; jwks: ReturnType<typeof createLocalJWKSet> };
let running: Subgraph | undefined;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k", alg: "RS256" };
  keys = { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
});

afterEach(async () => {
  await running?.shutdown();
  running = undefined;
  vi.unstubAllEnvs();
});

/** An access token shaped as Cognito's (A-10), for one user. */
const tokenFor = (sub: string, claims: object = {}) =>
  new SignJWT({ token_use: "access", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("1h")
    .sign(keys.privateKey);

const start = async (store = createMemoryStore()) => {
  running = createWorkspaceSubgraph({
    env,
    store,
    keys: keys.jwks,
    signals: new EventEmitter(),
    logStream: { write: () => undefined },
  });
  const url = `http://127.0.0.1:${String(await running.listen())}/graphql`;
  return { url, store };
};

interface Answer {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

const ask = async (
  url: string,
  query: string,
  variables: object = {},
  headers: Record<string, string> = {},
): Promise<Answer> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ query, variables }),
  });
  return (await response.json()) as Answer;
};

const as = async (sub: string) => ({ authorization: `Bearer ${await tokenFor(sub)}` });

const SAVE = /* GraphQL */ `
  mutation Save($id: ID, $name: String!, $drafts: [SchemaDraftInput!]!, $screenMap: String) {
    saveWorkspace(
      id: $id
      name: $name
      drafts: $drafts
      operations: "query A { a }"
      screenMap: $screenMap
    ) {
      id
      name
      drafts {
        subgraph
        sdl
      }
      operations
      screenMap
    }
  }
`;
const LIST = "{ workspaces { id name } }";
const GET = "query Get($id: ID!) { workspace(id: $id) { id name } }";
const DELETE = "mutation Delete($id: ID!) { deleteWorkspace(id: $id) }";
const drafts = [{ subgraph: "packages", sdl: "type Query { a: String }" }];

const save = async (url: string, sub: string, variables: object = {}) => {
  const answer = await ask(url, SAVE, { name: "Checkout", drafts, ...variables }, await as(sub));
  return answer.data?.saveWorkspace as { id: string } | undefined;
};

describe("a signed-in user's workspaces", () => {
  it("[FR-WB-11] saves drafts, operations and a screen map, then lists and reopens them", async () => {
    const { url } = await start();
    const saved = await save(url, "ada", { screenMap: "Checkout: A" });

    expect(saved).toMatchObject({
      name: "Checkout",
      drafts,
      operations: "query A { a }",
      screenMap: "Checkout: A",
    });
    expect((await ask(url, LIST, {}, await as("ada"))).data?.workspaces).toEqual([
      { id: saved?.id, name: "Checkout" },
    ]);
    expect((await ask(url, GET, { id: saved?.id }, await as("ada"))).data?.workspace).toEqual({
      id: saved?.id,
      name: "Checkout",
    });
  });

  it("[FR-WB-11] updates a workspace it owns, and deletes it", async () => {
    const { url } = await start();
    const saved = await save(url, "ada");
    const renamed = await save(url, "ada", { id: saved?.id, name: "Renamed" });

    expect(renamed).toMatchObject({ id: saved?.id, name: "Renamed" });
    expect((await ask(url, DELETE, { id: saved?.id }, await as("ada"))).data).toEqual({
      deleteWorkspace: true,
    });
    expect((await ask(url, LIST, {}, await as("ada"))).data?.workspaces).toEqual([]);
  });

  it("[FR-SG-1] can't read, change or delete another user's workspace", async () => {
    const { url } = await start();
    const theirs = await save(url, "ada");
    const id = theirs?.id;
    const grace = await as("grace");

    expect((await ask(url, LIST, {}, grace)).data?.workspaces).toEqual([]);
    expect((await ask(url, GET, { id }, grace)).data?.workspace).toBeNull();
    const update = await ask(url, SAVE, { id, name: "Taken", drafts }, grace);
    expect(update.errors?.[0]).toMatchObject({
      message: "No such workspace.",
      extensions: { code: "NOT_FOUND" },
    });
    expect((await ask(url, DELETE, { id }, grace)).data).toEqual({ deleteWorkspace: false });
    expect((await ask(url, GET, { id }, await as("ada"))).data?.workspace).toEqual({
      id,
      name: "Checkout",
    });
  });

  it.each([
    ["no token", async () => ({})],
    ["a forged user header", async () => ({ "x-user-id": "ada" })],
    [
      "an ID token",
      async () => ({ authorization: `Bearer ${await tokenFor("ada", { token_use: "id" })}` }),
    ],
  ])("[GR-3] refuses every operation with %s", async (_, headers) => {
    const { url } = await start();
    const id = (await save(url, "ada"))?.id;
    const sent = await headers();

    for (const [query, variables] of [
      [LIST, {}],
      [GET, { id }],
      [SAVE, { name: "x", drafts }],
      [DELETE, { id }],
    ] as const) {
      const answer = await ask(url, query, variables, sent);
      expect(answer.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    }
  });

  it("[GR-3] takes no user ID from the caller: no operation has an argument for one", async () => {
    const { url } = await start();
    const answer = await ask(url, '{ workspaces(userId: "ada") { id } }', {}, await as("grace"));

    expect(answer.errors?.[0]?.message).toMatch(/Unknown argument "userId"/);
  });

  it("[FR-SG-1] reads an ID that can't be a workspace as no workspace", async () => {
    const { url } = await start();

    expect((await ask(url, GET, { id: "1 OR 1=1" }, await as("ada"))).data?.workspace).toBeNull();
    expect((await ask(url, DELETE, { id: "x" }, await as("ada"))).data).toEqual({
      deleteWorkspace: false,
    });
  });

  it("[FR-WB-11] refuses a save over the limits, and a workspace past the last allowed", async () => {
    const { url } = await start();
    const tooLong = await ask(url, SAVE, { name: "x".repeat(101), drafts }, await as("ada"));
    expect(tooLong.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");

    for (let i = 0; i < MAX_WORKSPACES; i += 1) await save(url, "ada");
    const full = await ask(url, SAVE, { name: "One more", drafts }, await as("ada"));
    expect(full.errors?.[0]).toMatchObject({
      message: "Keep at most 50 workspaces. Delete one first.",
      extensions: { code: "WORKSPACE_LIMIT" },
    });
  });

  it("[FR-SG-9] releases the store when it stops", async () => {
    const { store } = await start();
    await running?.shutdown();
    running = undefined;

    expect(store.closed).toBe(true);
  });
});

describe("its settings", () => {
  it("[GR-3] won't start without token settings", () => {
    const withoutKeys = Object.fromEntries(
      Object.entries(env).filter(([name]) => !name.startsWith("JW")),
    );

    expect(() => createWorkspaceSubgraph({ env: withoutKeys, store: createMemoryStore() })).toThrow(
      "This subgraph needs JWKS_URL, JWT_AUDIENCE and JWT_ISSUER",
    );
  });

  it.each([
    "postgres://traverse@127.0.0.1:5432/traverse",
    "postgresql://traverse@postgres:5432/traverse",
    "postgres://traverse@db.traverse.example:5432/traverse?sslmode=verify-full",
  ])("[NFR-7] connects to %s", async (url) => {
    const pool = createDatabasePool({ DATABASE_URL: url });

    expect(pool).toBeDefined();
    await pool.end();
  });

  it.each([
    ["no database", undefined],
    ["a remote database in plain text", "postgres://traverse:secret@db.traverse.example/traverse"],
    [
      "a remote database that doesn't check its certificate",
      "postgres://db.traverse.example/x?sslmode=require",
    ],
    ["another scheme", "mysql://127.0.0.1/traverse"],
  ])("[NFR-7] refuses %s, and never repeats it", (_, url) => {
    const create = () => createDatabasePool({ DATABASE_URL: url });

    expect(create).toThrow();
    expect(create).not.toThrow(/secret/);
  });
});

describe("the entrypoint", () => {
  it("[FR-SG-9] starts the subgraph, and stops on SIGTERM", async () => {
    for (const [name, value] of Object.entries({
      ...env,
      DATABASE_URL: "postgres://traverse@127.0.0.1:1/traverse",
    })) {
      vi.stubEnv(name, value);
    }

    await expectEntrypointToRun(() => import("../src/main.ts"));
  });
});
