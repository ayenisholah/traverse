import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findUnsafeRouterEnvironment } from "@traverse/repo-checks";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import {
  runSubgraph,
  serveUpstream,
  type RunningSubgraph,
} from "../../../packages/subgraph-kit/test/support/run-subgraph.ts";
import { replay as replayOsv } from "../../../subgraphs/advisories/test/helpers.ts";
import { replay as replayNpm } from "../../../subgraphs/packages/test/helpers.ts";
import { replay as replayGithub } from "../../../subgraphs/repositories/test/helpers.ts";

/** The pinned image, by digest, so a moved tag can't change what's tested. */
const ROUTER_IMAGE =
  "ghcr.io/wundergraph/cosmo/router@sha256:1a8bc23db2c33c2028720b85b56fce68b7bf35f1064bac0f8301eb5ca6cae81c";
const AUDIENCE = "traverse-router";
const ROUTER_PORT = 3902;
const OVERRIDE_PORT = 3903;

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
  stop: () => Promise<void>;
}

interface Router {
  url: string;
  stop: () => Promise<void>;
}

interface TokenOptions {
  audience?: string;
  expires?: string;
  key?: CryptoKey;
}

const serveJwks = async (key: JWK): Promise<Server> => {
  const server = createServer((_, response) => {
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ keys: [{ ...key, kid: "k", alg: "RS256", use: "sig" }] }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
};

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

interface RouterOptions {
  port: number;
  files: string;
  issuer: string;
  override?: string;
}

const runRouter = async ({ port, files, issuer, override }: RouterOptions): Promise<Router> => {
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
    ROUTER_JWKS_URL: `${issuer}/jwks.json`,
    ROUTER_JWT_AUDIENCE: AUDIENCE,
  };
  // The public router runs under the same rule a deployment must meet. Only the test-only second
  // router, which merges an override, loads more than one file.
  const unsafe = findUnsafeRouterEnvironment(env).filter(
    (name) => override === undefined || name !== "CONFIG_PATH",
  );
  if (unsafe.length > 0) throw new Error(`Unsafe router environment: ${unsafe.join(", ")}`);
  const url = `http://127.0.0.1:${String(port)}`;
  const name = `traverse-router-test-${String(process.pid)}-${String(port)}`;
  const router = spawn("docker", [
    ...["run", "--rm", "--name", name, "--network", "host"],
    ...["-v", `${resolve("router")}:/config:ro`, "-v", `${files}:/files:ro`],
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
  return { url, stop };
};

/**
 * Runs the real graph: recorded npm, GitHub and OSV answers, the three subgraphs as real processes
 * on the ports in router/graph.yaml, a local token issuer, and the pinned router with the public
 * config, unchanged. Only the operations folder is a copy, so a test can persist its own.
 */
export const startStack = async (): Promise<Stack> => {
  let githubBlocked = false;
  const npm = await serveUpstream((path) => replayNpm(`http://upstream${path}`));
  const github = await serveUpstream((_, body) =>
    githubBlocked ? new Response("{}", { status: 503 }) : replayGithub(body),
  );
  const osv = await serveUpstream(replayOsv);

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
  ]);

  const keys = await generateKeyPair("RS256");
  const jwks = await serveJwks(await exportJWK(keys.publicKey));
  const issuer = `http://127.0.0.1:${String((jwks.address() as AddressInfo).port)}`;

  const files = mkdtempSync(join(tmpdir(), "traverse-router-"));
  cpSync("router/persisted", join(files, "persisted"), { recursive: true });

  const stopGraph = () => {
    for (const subgraph of subgraphs) subgraph.child.kill("SIGKILL");
    for (const server of [npm.server, github.server, osv.server, jwks]) server.close();
    rmSync(files, { recursive: true, force: true });
  };
  const router = await runRouter({ port: ROUTER_PORT, files, issuer }).catch((error: unknown) => {
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
    token: ({ audience = AUDIENCE, expires = "1h", key = keys.privateKey } = {}) =>
      new SignJWT({ sub: "user-1" })
        .setProtectedHeader({ alg: "RS256", kid: "k" })
        .setAudience(audience)
        .setIssuer(issuer)
        .setExpirationTime(expires)
        .sign(key),
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
    startRouter: (override) => runRouter({ port: OVERRIDE_PORT, files, issuer, override }),
    stop,
  };
};
