import { createServer } from "node:http";
import { createUserVerifier, noUser, type KeySource } from "./auth.ts";
import { createRedisCache } from "./cache.ts";
import { parseConfig } from "./config.ts";
import { createGraphql, type SubgraphDefinition } from "./graphql.ts";
import { createRequestListener } from "./http.ts";
import { createLifecycle, type SignalSource } from "./lifecycle.ts";
import { createLogger, createRequestScope, type DestinationStream } from "./logging.ts";
import type { UpstreamFetch } from "./request.ts";
import { createUpstream } from "./upstream.ts";

export interface SubgraphDependencies {
  env?: Record<string, string | undefined>;
  logStream?: DestinationStream;
  keys?: KeySource | undefined;
  signals?: SignalSource;
  fetch?: UpstreamFetch;
  /** Tests skip the waits between retries. */
  sleep?: (ms: number) => Promise<void>;
}

export interface Subgraph {
  listen: (port?: number) => Promise<number>;
  shutdown: () => Promise<void>;
  closed: Promise<void>;
}

export const createSubgraph = (
  definition: SubgraphDefinition,
  dependencies: SubgraphDependencies = {},
): Subgraph => {
  const { env, logStream, keys, signals, fetch, sleep } = {
    env: process.env,
    signals: process,
    fetch: globalThis.fetch,
    ...dependencies,
  };
  const config = parseConfig(env);
  const logger = createLogger(definition.name, config.logLevel, logStream);
  const scope = createRequestScope(logger);
  const verifyUser = config.jwt ? createUserVerifier(keys, config.jwt) : noUser;
  const cache = config.redisUrl === undefined ? undefined : createRedisCache(config.redisUrl);
  const upstream = (source: string) =>
    createUpstream({ source, fetch, cache, logger: scope.current, ...(sleep && { sleep }) });
  const yoga = createGraphql(definition, { upstream }, verifyUser, scope);

  const server = createServer(
    createRequestListener({
      serve: (request, response, context) => void yoga(request, response, context),
      isReady: () => lifecycle.isReady(),
      logger,
      scope,
    }),
  );
  const lifecycle = createLifecycle({
    server,
    signals,
    logger,
    drainMs: config.drainMs,
    closeMs: config.closeMs,
    dispose: async () => {
      await yoga.dispose();
      await cache?.close();
    },
  });

  return {
    listen: (port = config.port) => lifecycle.listen(port),
    shutdown: lifecycle.shutdown,
    closed: lifecycle.closed,
  };
};
