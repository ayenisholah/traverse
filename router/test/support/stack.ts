import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findUnsafeRouterEnvironment, findUnsafeSandboxEnvironment } from "@traverse/repo-checks";
import {
  runSubgraph,
  serveUpstream,
  type RunningSubgraph,
} from "../../../packages/subgraph-kit/test/support/run-subgraph.ts";
import { replay as replayOsv } from "../../../subgraphs/advisories/test/helpers.ts";
import { replay as replayNpm } from "../../../subgraphs/packages/test/helpers.ts";
import { replay as replayGithub } from "../../../subgraphs/repositories/test/helpers.ts";
import { migrate } from "../../../subgraphs/workspace/src/migrate.ts";
import { startDatabase } from "../../../subgraphs/workspace/test/postgres/database.ts";
import { startIssuer, type TokenOptions } from "./issuer.ts";

/** The pinned image, by digest, so a moved tag can't change what's tested. */
const ROUTER_IMAGE =
  "ghcr.io/wundergraph/cosmo/router@sha256:1a8bc23db2c33c2028720b85b56fce68b7bf35f1064bac0f8301eb5ca6cae81c";
// The resource the web server binds its users' access tokens to (A-12, ADR 0020).
const AUDIENCE = "https://router.traverse.test";
const ROUTER_PORT = 3902;
const OVERRIDE_PORT = 3903;
const SANDBOX_PORT = 3904;
const DATABASE_PORT = 5434;

export interface Stack {
  url: string;
  /** Makes GitHub answer 503 until the next call. */
  blockGithub: (blocked: boolean) => void;
  token: (options?: TokenOptions) => Promise<string>;
  persist: (body: string) => string;
  /** How many requests the subgraphs have served, once their logs stop changing. */
  subgraphRequests: () => Promise<number>;
  /** A second router on the same graph, with the public config and a test-only override merged. */
  startRouter: (override: string) => Promise<Router>;
  /** The sandbox router on the same graph, with its own config, unchanged. */
  startSandbox: () => Promise<Router>;
  stop: () => Promise<void>;
  /** What a web server needs to sign users in at the stack's issuer. */
  auth: { domainUrl: string; clientId: string; clientSecret: string; resource: string };
}

export interface Router {
  url: string;
  /** Everything the container has written so far. */
  logs: () => string;
  stop: () => Promise<void>;
}

const waitForReady = async (url: string, router: ChildProcess, logs: () => string) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (router.exitCode !== null) throw new Error(`The router stopped:\n${logs()}`);
    const ready = await fetch(`${url}/health/ready`, { signal: AbortSignal.timeout(2000) }).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`The router never became ready:\n${logs()}`);
};

interface ContainerOptions {
  port: number;
  env: Record<string, string>;
  /** A host folder mounted read-only at /files, for files a test writes. */
  files?: string;
}

const runContainer = async ({ port, env, files }: ContainerOptions): Promise<Router> => {
  const url = `http://127.0.0.1:${String(port)}`;
  const name = `traverse-router-test-${String(process.pid)}-${String(port)}`;
  const router = spawn("docker", [
    ...["run", "--rm", "--name", name, "--network", "host"],
    ...["-v", `${resolve("router")}:/config:ro`],
    ...(files === undefined ? [] : ["-v", `${files}:/files:ro`]),
    ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    ROUTER_IMAGE,
  ]);
  let logs = "";
  router.stdout.on("data", (chunk: Buffer) => (logs += chunk.toString()));
  router.stderr.on("data", (chunk: Buffer) => (logs += chunk.toString()));
  const stop = async () => {
    execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" });
    await once(router, "exit").catch(() => undefined);
  };
  try {
    await waitForReady(url, router, () => logs);
  } catch (error) {
    await stop();
    throw error;
  }
  return { url, logs: () => logs, stop };
};

interface RouterOptions {
  port: number;
  files: string;
  jwksUrl: string;
  override?: string;
}

const runRouter = ({ port, files, jwksUrl, override }: RouterOptions): Promise<Router> => {
  const configs = ["/config/config.yaml"];
  if (override !== undefined) {
    writeFileSync(join(files, `override-${String(port)}.yaml`), override);
    configs.push(`/files/override-${String(port)}.yaml`);
  }
  const env: Record<string, string> = {
    CONFIG_PATH: configs.join(","),
    ROUTER_LISTEN_ADDR: `127.0.0.1:${String(port)}`,
    ROUTER_CORS_ORIGIN: "https://traverse.example",
    ROUTER_EXECUTION_CONFIG: "/config/config.json",
    ROUTER_OPERATIONS_DIR: "/files/persisted",
    ROUTER_JWKS_URL: jwksUrl,
    ROUTER_JWT_AUDIENCE: AUDIENCE,
  };
  // The public router runs under the same rule a deployment must meet. Only the test-only second
  // router, which merges an override, loads more than one file.
  const unsafe = findUnsafeRouterEnvironment(env).filter(
    (name) => override === undefined || name !== "CONFIG_PATH",
  );
  if (unsafe.length > 0) throw new Error(`Unsafe router environment: ${unsafe.join(", ")}`);
  return runContainer({ port, env, files });
};

interface SandboxOptions {
  /** The execution config to serve, as a path under router/. */
  executionConfig: string;
  port?: number;
  /** Variables a deployment must never set, for tests that prove the file wins over them. */
  hostileEnv?: Record<string, string>;
}

/**
 * Runs the pinned router with router/sandbox.yaml, unchanged, bound to loopback. Its environment
 * passes the rule a deployment must meet, unless a test adds hostile variables on purpose.
 */
export const startSandboxRouter = ({
  executionConfig,
  port = SANDBOX_PORT,
  hostileEnv = {},
}: SandboxOptions): Promise<Router> => {
  const env = {
    CONFIG_PATH: "/config/sandbox.yaml",
    ROUTER_LISTEN_ADDR: `127.0.0.1:${String(port)}`,
    ROUTER_EXECUTION_CONFIG: `/config/${executionConfig}`,
  };
  const unsafe = findUnsafeSandboxEnvironment(env);
  if (unsafe.length > 0) throw new Error(`Unsafe sandbox environment: ${unsafe.join(", ")}`);
  return runContainer({ port, env: { ...env, ...hostileEnv } });
};

/**
 * Runs the real graph: recorded npm, GitHub and OSV answers, the three subgraphs as real processes
 * on the ports in router/graph.yaml, a local token issuer, and the pinned router with the public
 * config, unchanged. Only the operations folder is a copy, so a test can persist its own.
 */
export const startStack = async ({ webOrigin }: { webOrigin?: string } = {}): Promise<Stack> => {
  let githubBlocked = false;
  const npm = await serveUpstream((path) => replayNpm(`http://upstream${path}`));
  const github = await serveUpstream((_, body) =>
    githubBlocked ? new Response("{}", { status: 503 }) : replayGithub(body),
  );
  const osv = await serveUpstream(replayOsv);

  // Tests take tokens from it directly, or sign in through a web server at `webOrigin`.
  const issuer = await startIssuer({
    clientId: "traverse-web",
    clientSecret: "test-secret",
    resource: AUDIENCE,
    redirectUris: webOrigin === undefined ? [] : [`${webOrigin}/auth/callback`],
    logoutUris: webOrigin === undefined ? [] : [`${webOrigin}/`],
  });
  const { jwksUrl } = issuer;

  const database = await startDatabase(DATABASE_PORT);
  const migrations = database.pool();
  await migrate(migrations);
  await migrations.end();

  const subgraphs: RunningSubgraph[] = await Promise.all([
    runSubgraph(resolve("subgraphs/packages/src/main.ts"), {
      PORT: "4101",
      NPM_REGISTRY_URL: npm.url,
      NPM_DOWNLOADS_URL: npm.url,
    }),
    runSubgraph(resolve("subgraphs/repositories/src/main.ts"), {
      PORT: "4102",
      GITHUB_TOKEN: "test-token",
      GITHUB_GRAPHQL_URL: `${github.url}/graphql`,
    }),
    runSubgraph(resolve("subgraphs/advisories/src/main.ts"), { PORT: "4103", OSV_URL: osv.url }),
    // Verifies tokens itself against the issuer's keys, as a deployment would (GR-3).
    runSubgraph(resolve("subgraphs/workspace/src/main.ts"), {
      PORT: "4105",
      DATABASE_URL: database.url,
      JWKS_URL: jwksUrl,
      JWT_AUDIENCE: AUDIENCE,
      JWT_ISSUER: issuer.url,
    }),
  ]);

  const files = mkdtempSync(join(tmpdir(), "traverse-router-"));
  cpSync("router/persisted", join(files, "persisted"), { recursive: true });

  const stopGraph = () => {
    for (const subgraph of subgraphs) subgraph.child.kill("SIGKILL");
    for (const server of [npm.server, github.server, osv.server]) server.close();
    void issuer.stop();
    database.stop();
    rmSync(files, { recursive: true, force: true });
  };
  const router = await runRouter({ port: ROUTER_PORT, files, jwksUrl }).catch((error: unknown) => {
    stopGraph();
    throw error;
  });
  const stop = async () => {
    await router.stop();
    stopGraph();
  };

  const countRequests = () =>
    subgraphs.reduce(
      (total, subgraph) => total + subgraph.output().split('"msg":"request"').length - 1,
      0,
    );

  return {
    url: router.url,
    blockGithub: (blocked) => {
      githubBlocked = blocked;
    },
    token: (options) => issuer.token({ sub: "user-1", expires: "1h", ...options }),
    persist: (body) => {
      const hash = createHash("sha256").update(body).digest("hex");
      writeFileSync(
        join(files, "persisted/operations", `${hash}.json`),
        JSON.stringify({ version: 1, body }),
      );
      return hash;
    },
    // A subgraph logs a request just after answering it, so wait until the count holds still.
    subgraphRequests: async () => {
      let count = countRequests();
      for (;;) {
        await new Promise((done) => setTimeout(done, 300));
        const next = countRequests();
        if (next === count) return count;
        count = next;
      }
    },
    startRouter: (override) => runRouter({ port: OVERRIDE_PORT, files, jwksUrl, override }),
    startSandbox: () => startSandboxRouter({ executionConfig: "config.json" }),
    stop,
    auth: {
      domainUrl: issuer.url,
      clientId: "traverse-web",
      clientSecret: "test-secret",
      resource: AUDIENCE,
    },
  };
};
