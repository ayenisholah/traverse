import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

const app = join(import.meta.dirname, "../..");
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");

interface PersistedRequest {
  variables?: { name?: string };
  extensions?: { persistedQuery?: { sha256Hash?: string } };
}

export interface StubRouter {
  url: string;
  /** Every body the web server sent, in order. */
  requests: PersistedRequest[];
  stop: () => void;
}

/**
 * Stands in for the public router, so these tests need no Docker. It answers one hash, with the
 * pinned router's own answer for express, recorded from router/test/support/stack.ts. Like the
 * real router, it refuses a hash it doesn't hold. router/test/e2e covers the real path.
 */
export const startStubRouter = async (hash: string, port = 0): Promise<StubRouter> => {
  const express = readFileSync(join(app, "test/fixtures/router-package-express.json"), "utf8");
  const requests: PersistedRequest[] = [];
  const answer = (body: PersistedRequest): string => {
    if (body.extensions?.persistedQuery?.sha256Hash !== hash) {
      return JSON.stringify({ errors: [{ message: "PersistedQueryNotFound" }] });
    }
    return body.variables?.name === "express"
      ? express
      : JSON.stringify({ data: { package: null } });
  };
  const server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk: Buffer) => (text += chunk.toString()));
    request.on("end", () => {
      const body = JSON.parse(text) as PersistedRequest;
      requests.push(body);
      response.writeHead(200, { "content-type": "application/json" }).end(answer(body));
    });
  }).listen(port, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    requests,
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
