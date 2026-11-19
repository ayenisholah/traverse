import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

const app = join(import.meta.dirname, "../..");
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");

interface PersistedRequest {
  variables?: Record<string, unknown> & { name?: string; version?: string };
  extensions?: { persistedQuery?: { sha256Hash?: string } };
}

interface StoredWorkspace {
  id: string;
  name: string;
  drafts: { subgraph: string; sdl: string }[];
  operations: string;
  screenMap: string | null;
  updatedAt: string;
}

/**
 * The workspace subgraph's behaviour, for the browser tests: each user's own workspaces, keyed by
 * their token's subject. It reads the subject without checking the signature, which only the
 * real subgraph does; router/test/e2e proves that path on the pinned router.
 */
const createWorkspaces = () => {
  const byUser = new Map<string, StoredWorkspace[]>();
  const signIn = {
    errors: [
      {
        message: "x",
        extensions: {
          errors: [{ message: "Sign in first.", extensions: { code: "UNAUTHENTICATED" } }],
        },
      },
    ],
  };
  const subjectOf = (authorization: string | undefined) => {
    const payload = authorization?.replace(/^Bearer /, "").split(".")[1];
    if (payload === undefined) return undefined;
    return (JSON.parse(Buffer.from(payload, "base64url").toString()) as { sub?: string }).sub;
  };
  return (
    operation: string,
    variables: Record<string, unknown>,
    authorization: string | undefined,
  ) => {
    const user = subjectOf(authorization);
    if (user === undefined) return signIn;
    const own = byUser.get(user) ?? [];
    byUser.set(user, own);
    const id = variables.id as string | undefined;
    if (operation === "workspaces") {
      return {
        data: {
          workspaces: own.map(({ id: key, name, updatedAt }) => ({ id: key, name, updatedAt })),
        },
      };
    }
    if (operation === "workspace")
      return { data: { workspace: own.find((each) => each.id === id) ?? null } };
    if (operation === "deleteWorkspace") {
      const at = own.findIndex((each) => each.id === id);
      if (at >= 0) own.splice(at, 1);
      return { data: { deleteWorkspace: at >= 0 } };
    }
    const saved: StoredWorkspace = {
      id: id ?? randomUUID(),
      name: variables.name as string,
      drafts: variables.drafts as StoredWorkspace["drafts"],
      operations: variables.operations as string,
      screenMap: (variables.screenMap as string | null | undefined) ?? null,
      updatedAt: new Date().toISOString(),
    };
    const at = own.findIndex((each) => each.id === saved.id);
    if (at >= 0) own.splice(at, 1);
    own.unshift(saved);
    return {
      data: { saveWorkspace: { id: saved.id, name: saved.name, updatedAt: saved.updatedAt } },
    };
  };
};

export interface StubRouter {
  url: string;
  /** Every body the web server sent, in order. */
  requests: PersistedRequest[];
  stop: () => void;
}

const fixture = (name: string) => readFileSync(join(app, "test/fixtures", `${name}.json`), "utf8");

/**
 * Stands in for the public router, so these tests need no Docker. It answers the shipped
 * operations with the pinned router's own answers, recorded from router/test/support/stack.ts, for
 * the packages those recordings hold, and any other package as missing. Like the real router, it
 * refuses a hash it doesn't hold. router/test/e2e covers the real path.
 */
export const startStubRouter = async (
  hashes: Awaited<ReturnType<typeof shippedHashes>>,
  port = 0,
): Promise<StubRouter> => {
  const workspaces = createWorkspaces();
  const workspaceOperations = new Map([
    [hashes.workspaces, "workspaces"],
    [hashes.workspace, "workspace"],
    [hashes.saveWorkspace, "saveWorkspace"],
    [hashes.deleteWorkspace, "deleteWorkspace"],
  ]);
  const answers = new Map([
    [`${hashes.package}:express`, fixture("router-package-express")],
    [`${hashes.packagePage}:express`, fixture("router-page-express")],
    [`${hashes.dependency}:lodash@4.17.20`, fixture("router-dep-lodash")],
    [`${hashes.dependency}:zod@4.0.0`, fixture("router-dep-zod")],
    [`${hashes.dependency}:ms@2.1.3`, fixture("router-dep-ms")],
  ]);
  const requests: PersistedRequest[] = [];
  const answer = (
    { extensions, variables = {} }: PersistedRequest,
    authorization: string | undefined,
  ): string => {
    const hash = extensions?.persistedQuery?.sha256Hash ?? "";
    const workspaceOperation = workspaceOperations.get(hash);
    if (workspaceOperation !== undefined) {
      return JSON.stringify(workspaces(workspaceOperation, variables, authorization));
    }
    if (!Object.values(hashes).includes(hash)) {
      return JSON.stringify({ errors: [{ message: "PersistedQueryNotFound" }] });
    }
    const key = `${hash}:${String(variables.name)}${variables.version ? `@${variables.version}` : ""}`;
    return answers.get(key) ?? JSON.stringify({ data: { package: null } });
  };
  const server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk: Buffer) => (text += chunk.toString()));
    request.on("end", () => {
      const body = JSON.parse(text) as PersistedRequest;
      requests.push(body);
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(answer(body, request.headers.authorization));
    });
  }).listen(port, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    requests,
    stop: () => server.close(),
  };
};

/** The shipped operations' hashes, as the stub router needs them. */
export const shippedHashes = async () => {
  const operations = await import("../../src/generated/operations.ts");
  return {
    package: operations.PackageOperation.sha256,
    packagePage: operations.PackagePageOperation.sha256,
    dependency: operations.DependencyOperation.sha256,
    workspaces: operations.WorkspacesOperation.sha256,
    workspace: operations.WorkspaceOperation.sha256,
    saveWorkspace: operations.SaveWorkspaceOperation.sha256,
    deleteWorkspace: operations.DeleteWorkspaceOperation.sha256,
  };
};

export interface StubSandbox {
  url: string;
  /** Every operation the web server sent, in order. */
  operations: string[];
  stop: () => void;
}

/**
 * Stands in for the sandbox router. It answers any operation with the pinned router's own answer
 * for the Package operation, plan included, recorded from router/test/support/stack.ts. An
 * operation holding "nope" or a mutation gets the router's own refusals, word for word.
 */
export const startStubSandbox = async (port = 0): Promise<StubSandbox> => {
  const planned = fixture("sandbox-package");
  const operations: string[] = [];
  const refuse = (message: string) => JSON.stringify({ errors: [{ message }] });
  const answer = (query: string): string => {
    if (query.includes("nope")) return refuse('Cannot query field "nope" on type "Package".');
    if (/^\s*mutation\b/.test(query)) return refuse("operation type 'mutation' is blocked");
    return planned;
  };
  const server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk: Buffer) => (text += chunk.toString()));
    request.on("end", () => {
      const { query } = JSON.parse(text) as { query: string };
      operations.push(query);
      response.writeHead(200, { "content-type": "application/json" }).end(answer(query));
    });
  }).listen(port, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    operations,
    stop: () => server.close(),
  };
};

export interface WebServer {
  url: string;
  output: () => string;
  /** Resolves with the exit code once the server stops, by itself or through `stop`. */
  exited: Promise<number | null>;
  stop: () => Promise<void>;
}

/** Runs the server build as a deployment would, with only the environment given here. */
export const startWebServer = (port: number, env: Record<string, string>): WebServer => {
  const child = spawn(process.execPath, [next, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: app,
    env: { PATH: process.env.PATH, NODE_ENV: "production", TRAVERSE_BUILD: "server", ...env },
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const exited = once(child, "exit").then(([code]) => code as number | null);
  return {
    url: `http://127.0.0.1:${String(port)}`,
    output: () => output,
    exited,
    stop: async () => {
      child.kill("SIGTERM");
      await exited;
    },
  };
};

export const waitUntilReady = async (server: WebServer): Promise<void> => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const ready = await fetch(server.url, { signal: AbortSignal.timeout(2000) }).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  await server.stop();
  throw new Error(`The web server never became ready:\n${server.output()}`);
};

export const freePort = async (): Promise<number> => {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, "close");
  return port;
};
