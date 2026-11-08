import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, expect, vi } from "vitest";
import type { Cache } from "../../src/cache.ts";
import type { Subgraph, SubgraphDependencies } from "../../src/index.ts";
import { createLogger } from "../../src/logging.ts";

export interface RunningSubgraph {
  child: ChildProcess;
  url: string;
  output: () => string;
}

/** Starts a real Node process, because Vitest loads modules differently from production. */
export const runSubgraph = async (
  main: string,
  env: Record<string, string>,
): Promise<RunningSubgraph> => {
  const child = spawn(process.execPath, [main], {
    env: { PATH: process.env.PATH, PORT: "0", SHUTDOWN_DRAIN_MS: "0", ...env },
  });
  let output = "";
  const port = await new Promise<string>((done) => {
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const found = /"port":(\d+)/.exec(output)?.[1];
      if (found !== undefined) done(found);
    });
  });
  return { child, url: `http://127.0.0.1:${port}`, output: () => output };
};

/** Serves an upstream's recorded answers over real HTTP, and returns its address. */
export const serveUpstream = async (
  answer: (path: string, body: string) => Response,
): Promise<{ url: string; server: Server; lastHeaders: () => IncomingHttpHeaders }> => {
  let lastHeaders: IncomingHttpHeaders = {};
  const server = createServer((request, response) => {
    lastHeaders = request.headers;
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const reply = answer(String(request.url), body);
      void reply.text().then((text) => {
        response.writeHead(reply.status, { "content-type": "application/json" }).end(text);
      });
    });
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server, lastHeaders: () => lastHeaders };
};

/** Proves an entrypoint starts its subgraph and stops on SIGTERM, with the environment it needs. */
export const expectEntrypointToRun = async (load: () => Promise<unknown>): Promise<void> => {
  const before = process.listenerCount("SIGTERM");

  await load();

  expect(process.listenerCount("SIGTERM")).toBe(before + 1);
  process.emit("SIGTERM");
  await vi.waitFor(() => {
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });
};

type CreateSubgraph = (dependencies: SubgraphDependencies & { fetch?: typeof fetch }) => Subgraph;

/** Starts a subgraph for one test, stops it afterwards, and captures its logs. */
export const useSubgraph = (create: CreateSubgraph, env: Record<string, string> = {}) => {
  let running: Subgraph | undefined;

  afterEach(async () => {
    await running?.shutdown();
    running = undefined;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const listen = async (subgraph: Subgraph): Promise<string> => {
    running = subgraph;
    return `http://127.0.0.1:${await subgraph.listen()}/graphql`;
  };

  return {
    listen,
    start: (upstream: typeof fetch, logs: string[] = []): Promise<string> =>
      listen(
        create({
          fetch: upstream,
          env: { PORT: "0", SHUTDOWN_DRAIN_MS: "0", ...env },
          sleep: () => Promise.resolve(),
          logStream: { write: (line: string) => void logs.push(line) },
        }),
      ),
  };
};

/** Replaces global fetch, so a subgraph's default reaches recordings and tests reach the server. */
export const stubUpstream = (recorded: typeof fetch) => {
  const realFetch = globalThis.fetch;
  const upstream = vi.fn<typeof fetch>((input, init) =>
    (input as string).startsWith("http://127.0.0.1")
      ? realFetch(input, init)
      : recorded(input, init),
  );
  vi.stubGlobal("fetch", upstream);
  vi.stubEnv("PORT", "0");
  vi.stubEnv("SHUTDOWN_DRAIN_MS", "0");
  return upstream;
};

export const readSchemas = (...names: string[]): { name: string; sdl: string }[] =>
  names.map((name) => ({
    name,
    sdl: readFileSync(
      join(import.meta.dirname, `../../../../subgraphs/${name}/schema.graphqls`),
      "utf8",
    ),
  }));

export const silentLogger = createLogger("test", "silent", undefined);

/** A cache that lives for one test, with the store open for inspection. */
export const memoryCache = (): Cache & { store: Map<string, string> } => {
  const store = new Map<string, string>();
  return {
    store,
    get: (key) => Promise.resolve(store.get(key) ?? null),
    set: (key, value) => {
      store.set(key, value);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
};
