import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { connect } from "node:net";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { GraphQLError } from "graphql";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { hangingRedis } from "./support/fake-redis.ts";
import { createSubgraph, type Subgraph, type SubgraphDependencies } from "../src/index.ts";

const typeDefs = /* GraphQL */ `
  type Query {
    whoami: String
    trace: String
    fails: String
    refuses: String
    hangs: String
    echo(text: String): String
  }
  type Thing @key(fields: "id") {
    id: ID!
    name: String
  }
`;

const resolvers = {
  Query: {
    whoami: (_: unknown, __: unknown, context: { userId?: string }) =>
      context.userId ?? "anonymous",
    trace: (_: unknown, __: unknown, context: { traceId: string }) => context.traceId,
    fails: () => {
      throw new Error("connection to secret.internal failed");
    },
    refuses: () => {
      throw new GraphQLError("Source unavailable", {
        extensions: { code: "UPSTREAM_UNAVAILABLE" },
      });
    },
    hangs: () => new Promise(() => undefined),
    echo: (_: unknown, { text }: { text: string }) => text,
  },
  Thing: {
    __resolveReference: ({ id }: { id: string }) => ({ id, name: `thing ${id}` }),
  },
};

interface LogLine {
  level: number;
  name: string;
  msg: string;
  traceId?: string;
  [key: string]: unknown;
}

const issuer = "https://issuer.example";
const auth = {
  JWKS_URL: "http://keys/jwks.json",
  JWT_AUDIENCE: "traverse",
  JWT_ISSUER: issuer,
};
const quick = { PORT: "0", SHUTDOWN_DRAIN_MS: "0", SHUTDOWN_CLOSE_MS: "50" };

let keys: {
  privateKey: CryptoKey;
  publicJwk: object;
  jwks: ReturnType<typeof createLocalJWKSet>;
};
let running: Subgraph | undefined;
let logged: string[];

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k", alg: "RS256", use: "sig" };
  keys = { privateKey, publicJwk: jwk, jwks: createLocalJWKSet({ keys: [jwk] }) };
});

afterEach(async () => {
  await running?.shutdown();
  running = undefined;
  vi.unstubAllEnvs();
});

const start = async (overrides: Partial<SubgraphDependencies> = {}) => {
  logged = [];
  running = createSubgraph(
    { name: "test", typeDefs, resolvers },
    {
      env: { ...quick, ...auth },
      logStream: { write: (line: string) => void logged.push(line) },
      keys: keys.jwks,
      signals: new EventEmitter(),
      ...overrides,
    },
  );
  return `http://127.0.0.1:${await running.listen()}`;
};

const lines = (): LogLine[] => logged.map((line) => JSON.parse(line) as LogLine);

const query = async (
  url: string,
  body: { query: string; variables?: object },
  headers: Record<string, string> = {},
) => {
  const response = await fetch(`${url}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return (await response.json()) as {
    data?: Record<string, unknown>;
    errors?: { message: string; extensions?: { code?: string } }[];
  };
};

interface TokenOptions {
  audience?: string;
  from?: string;
  expires?: string | null;
}

const signed = (
  claims: object,
  { audience = "traverse", from = issuer, expires = "1h" }: TokenOptions = {},
  key?: CryptoKey,
) => {
  const jwt = new SignJWT({ sub: "user-1", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k" })
    .setAudience(audience)
    .setIssuer(from);
  if (expires !== null) jwt.setExpirationTime(expires);
  return jwt.sign(key ?? keys.privateKey);
};

const token = () => signed({});

const whoamiWith = async (url: string, jwt: string) => {
  const result = await query(url, { query: "{ whoami }" }, { authorization: `Bearer ${jwt}` });
  return result.data?.whoami;
};

describe("a subgraph from a schema and resolvers", () => {
  it("[FR-SG-7] serves its resolvers, its federation SDL and its entities", async () => {
    const url = await start();

    const { data } = await query(url, {
      query: `{
        echo(text: "hi")
        _service { sdl }
        _entities(representations: [{ __typename: "Thing", id: "1" }]) { ... on Thing { name } }
      }`,
    });

    expect(data?.echo).toBe("hi");
    expect(data?._service).toMatchObject({ sdl: expect.stringContaining("Thing") as string });
    expect(data?._entities).toEqual([{ name: "thing 1" }]);
  });

  it("[FR-SG-7] answers nothing but the router's POST", async () => {
    const url = await start();

    expect((await fetch(`${url}/`)).status).toBe(404);
    expect((await fetch(`${url}/anything/health`)).status).toBe(404);
    expect((await fetch(`${url}/graphql?query={whoami}`)).status).toBe(405);
    const form = await fetch(`${url}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "query={whoami}",
    });
    expect(form.status).toBe(415);
  });

  it("[FR-SG-7] sends no CORS headers", async () => {
    const url = await start();

    const response = await fetch(`${url}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ query: "{ whoami }" }),
    });

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("request limits", () => {
  it("[FR-SG-7] refuses a body far larger than the router sends", async () => {
    const url = await start();

    const response = await fetch(`${url}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: `{ whoami } # ${"x".repeat(1_100_000)}` }),
    });

    expect(response.status).toBe(413);
  });

  it("[FR-SG-7] refuses a query with too many tokens", async () => {
    const url = await start();
    const aliases = Array.from({ length: 12_000 }, (_, index) => `a${index}: whoami`).join(" ");

    const { errors, data } = await query(url, { query: `{ ${aliases} }` });

    expect(data).toBeUndefined();
    expect(errors?.[0]?.message).toContain("tokens");
  });
});

describe("health", () => {
  it("[FR-SG-7] reports live and ready", async () => {
    const url = await start();

    expect((await fetch(`${url}/health/live`)).status).toBe(200);
    expect((await fetch(`${url}/health/ready`)).status).toBe(200);
  });

  it("[FR-SG-7] stops being ready as soon as it starts to drain, and keeps serving", async () => {
    const url = await start({ env: { ...quick, SHUTDOWN_DRAIN_MS: "200" } });

    const stopping = running?.shutdown();
    const ready = await fetch(`${url}/health/ready`, { headers: { connection: "close" } });
    const live = await fetch(`${url}/health/live`, { headers: { connection: "close" } });

    expect(ready.status).toBe(503);
    expect(live.status).toBe(200);
    await stopping;
  });
});

describe("auth context", () => {
  it("[FR-SG-7] takes the user from a verified token", async () => {
    const url = await start();
    const headers = { authorization: `Bearer ${await token()}` };

    expect((await query(url, { query: "{ whoami }" }, headers)).data?.whoami).toBe("user-1");
  });

  it("[FR-SG-7] has no user without a token", async () => {
    const url = await start();

    expect((await query(url, { query: "{ whoami }" })).data?.whoami).toBe("anonymous");
  });

  it("[GR-3] ignores a token signed by another key", async () => {
    const url = await start();
    const { privateKey } = await generateKeyPair("RS256");

    expect(await whoamiWith(url, await signed({}, {}, privateKey))).toBe("anonymous");
  });

  it("[GR-3] ignores a token signed with another algorithm", async () => {
    const url = await start();
    const { privateKey } = await generateKeyPair("RS512");
    const jwt = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "RS512", kid: "k" })
      .setAudience("traverse")
      .setIssuer(issuer)
      .setExpirationTime("1h")
      .sign(privateKey);

    expect(await whoamiWith(url, jwt)).toBe("anonymous");
  });

  it("[GR-3] ignores an unsigned token", async () => {
    const url = await start();
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const claims = { sub: "user-1", aud: "traverse", iss: issuer, exp: 9_999_999_999 };

    const jwt = `${encode({ alg: "none" })}.${encode(claims)}.`;

    expect(await whoamiWith(url, jwt)).toBe("anonymous");
  });

  it("[GR-3] refuses a token that keys alone accept but only for the wrong algorithm", async () => {
    const hs256 = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("traverse")
      .setIssuer(issuer)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-shared-secret-of-sufficient-length"));
    const secret = new TextEncoder().encode("a-shared-secret-of-sufficient-length");
    const url = await start({ keys: () => Promise.resolve(secret) });

    expect(await whoamiWith(url, hs256)).toBe("anonymous");
  });

  it.each([
    ["another audience", { audience: "other" }],
    ["another issuer", { from: "https://evil.example" }],
    ["a past expiry", { expires: "-1h" }],
    ["no expiry", { expires: null }],
  ])("[GR-3] ignores a token with %s", async (_, options) => {
    const url = await start();

    expect(await whoamiWith(url, await signed({}, options))).toBe("anonymous");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["a number", 42],
    ["an object", { $ne: null }],
    ["a list", ["a", "b"]],
  ])("[GR-3] gives no user when sub is %s", async (_, sub) => {
    const url = await start();

    expect(await whoamiWith(url, await signed({ sub }))).toBe("anonymous");
  });

  it("[GR-3] ignores a forged user header", async () => {
    const url = await start();
    const headers = { "x-user-id": "user-1" };

    expect((await query(url, { query: "{ whoami }" }, headers)).data?.whoami).toBe("anonymous");
  });

  it("[GR-3] ignores a header that isn't a bearer token", async () => {
    const url = await start();
    const headers = { authorization: "Basic dXNlcjpwYXNz" };

    expect((await query(url, { query: "{ whoami }" }, headers)).data?.whoami).toBe("anonymous");
  });

  it("[GR-3] trusts no token when no keys are configured", async () => {
    const url = await start({ env: quick });

    expect(await whoamiWith(url, await token())).toBe("anonymous");
  });

  it("[FR-SG-7] fetches keys from JWKS_URL", async () => {
    const jwks = createServer((_, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [keys.publicJwk] }));
    }).listen(0, "127.0.0.1");
    await once(jwks, "listening");
    const { port } = jwks.address() as { port: number };
    const url = await start({
      keys: undefined,
      env: { ...quick, ...auth, JWKS_URL: `http://127.0.0.1:${port}/jwks.json` },
    });

    expect(await whoamiWith(url, await token())).toBe("user-1");
    jwks.close();
  });

  it("[FR-SG-7] logs a key outage, which would otherwise look like anonymous use", async () => {
    const url = await start({
      keys: undefined,
      env: { ...quick, ...auth, JWKS_URL: "http://127.0.0.1:1/jwks.json" },
    });

    expect(await whoamiWith(url, await token())).toBe("anonymous");
    expect(lines()).toContainEqual(
      expect.objectContaining({ msg: "token not verified", reason: "keys-unavailable" }),
    );
  });

  it("[GR-4] logs why a token failed, and never the token", async () => {
    const url = await start();
    const jwt = await signed({}, { expires: "-1h" });

    await whoamiWith(url, jwt);

    expect(lines()).toContainEqual(
      expect.objectContaining({ msg: "token not verified", reason: "ERR_JWT_EXPIRED" }),
    );
    expect(logged.join("\n")).not.toContain(jwt);
  });
});

describe("logging", () => {
  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  const traceparent = `00-${traceId}-00f067aa0ba902b7-01`;

  it("[FR-OB-6] writes JSON with the caller's trace ID", async () => {
    const url = await start();

    const result = await query(url, { query: "{ trace }" }, { traceparent });

    expect(result.data?.trace).toBe(traceId);
    await vi.waitFor(() => {
      expect(lines()).toContainEqual(
        expect.objectContaining({ name: "test", msg: "request", traceId, status: 200 }),
      );
    });
  });

  it("[FR-OB-6] makes a trace ID when the caller sends none, or a bad one", async () => {
    const url = await start();

    await query(url, { query: "{ trace }" });
    await query(url, { query: "{ trace }" }, { traceparent: "nonsense" });
    await query(
      url,
      { query: "{ trace }" },
      { traceparent: `00-${"0".repeat(32)}-${"a".repeat(16)}-01` },
    );
    await query(url, { query: "{ trace }" }, { traceparent: `ff-${traceId}-${"a".repeat(16)}-01` });

    await vi.waitFor(() => {
      expect(lines().filter(({ msg }) => msg === "request")).toHaveLength(4);
    });
    const ids = lines()
      .filter(({ msg }) => msg === "request")
      .map((line) => line.traceId);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(ids).size).toBe(4);
    expect(ids).not.toContain("0".repeat(32));
    expect(ids).not.toContain(traceId);
  });

  it("[FR-OB-6] skips health checks, which would drown everything else", async () => {
    const url = await start();

    await fetch(`${url}/health/ready`);

    expect(lines().filter(({ msg }) => msg === "request")).toEqual([]);
  });

  it("[GR-4] logs nothing a client chose in the URL or headers", async () => {
    const url = await start();

    await fetch(`${url}/user@example.com/private-path`);
    await fetch(`${url}/graphql?variables=private-value`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "session=private-cookie" },
      body: JSON.stringify({ query: "{ whoami }" }),
    });
    await vi.waitFor(() => {
      expect(lines().map(({ msg }) => msg)).toContain("request");
    });

    const output = logged.join("\n");
    for (const text of ["example.com", "private-path", "private-value", "private-cookie"]) {
      expect(output).not.toContain(text);
    }
  });

  it("[FR-OB-6] logs that it started and stopped", async () => {
    await start();
    await running?.shutdown();

    expect(lines().map(({ msg }) => msg)).toEqual(expect.arrayContaining(["listening", "stopped"]));
  });

  it("[GR-4] never logs variables, query text or tokens", async () => {
    const url = await start();
    const jwt = await token();

    await query(
      url,
      {
        query: "query Q($text: String) { echo(text: $text) }",
        variables: { text: "private-value" },
      },
      { authorization: `Bearer ${jwt}` },
    );

    await vi.waitFor(() => {
      expect(lines().map(({ msg }) => msg)).toContain("request");
    });
    const output = logged.join("\n");
    expect(output).not.toContain("private-value");
    expect(output).not.toContain("echo");
    expect(output).not.toContain(jwt);
  });
});

describe("errors", () => {
  it("[FR-SG-7] masks an unexpected error from clients, and logs it with the trace ID", async () => {
    const url = await start();

    const { errors } = await query(url, { query: "{ fails }" });

    expect(errors?.[0]?.message).toBe("Unexpected error.");
    expect(JSON.stringify(errors)).not.toContain("secret.internal");
    const logLine = lines().find(({ msg }) => msg === "resolver failed");
    expect(logLine).toMatchObject({ error: "Error", field: "fails" });
    expect(logLine?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(logged.join("\n")).not.toContain("secret.internal");
  });

  it("[GR-4] keeps the stack from clients even if NODE_ENV says development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const url = await start();

    const { errors } = await query(url, { query: "{ fails }" });

    expect(JSON.stringify(errors)).not.toContain("secret.internal");
    expect(JSON.stringify(errors)).not.toContain("originalError");
  });

  it("[GR-4] logs the field, not the client's alias", async () => {
    const url = await start();

    await query(url, { query: "{ alice_at_example: fails }" });

    expect(logged.join("\n")).not.toContain("alice_at_example");
  });

  it("[FR-SG-7] passes a deliberate GraphQL error through with its code", async () => {
    const url = await start();

    const { errors } = await query(url, { query: "{ refuses }" });

    expect(errors?.[0]).toMatchObject({
      message: "Source unavailable",
      extensions: { code: "UPSTREAM_UNAVAILABLE" },
    });
  });
});

describe("shutdown", () => {
  it("[FR-SG-7] drains and closes on SIGTERM", async () => {
    const signals = new EventEmitter();
    const url = await start({ signals });

    signals.emit("SIGTERM");
    await running?.closed;

    await expect(fetch(`${url}/health/live`)).rejects.toThrow();
  });

  it("[FR-SG-7] can be asked to stop more than once", async () => {
    await start();

    await Promise.all([running?.shutdown(), running?.shutdown()]);

    expect(lines().filter(({ msg }) => msg === "stopped")).toHaveLength(1);
  });

  it("[FR-SG-7] finishes its drain when a second signal arrives", async () => {
    const signals = new EventEmitter();
    await start({ signals, env: { ...quick, SHUTDOWN_DRAIN_MS: "30" } });

    signals.emit("SIGTERM");
    signals.emit("SIGTERM");
    await running?.closed;

    expect(lines().filter(({ msg }) => msg === "stopped")).toHaveLength(1);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("[FR-SG-7] won't wait for a connection that sends nothing", async () => {
    const url = await start();
    const socket = connect(Number(new URL(url).port), "127.0.0.1");
    await once(socket, "connect");
    socket.on("error", () => undefined);
    socket.write("POST /graphql HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\npartial");

    await running?.shutdown();

    expect(lines().map(({ msg }) => msg)).toContain("stopped");
    socket.destroy();
  });

  it("[FR-SG-7] won't wait for a resolver that never settles", async () => {
    const url = await start();
    const pending = query(url, { query: "{ hangs }" }).catch(() => "dropped");
    await vi.waitFor(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await running?.shutdown();

    expect(await pending).toBe("dropped");
    expect(lines().map(({ msg }) => msg)).toContain("stopped");
  });

  it("[FR-OB-6] logs a request the caller abandons", async () => {
    const url = await start();
    const controller = new AbortController();

    const pending = fetch(`${url}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ hangs }" }),
      signal: controller.signal,
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();
    await pending;

    await vi.waitFor(() => {
      expect(lines().map(({ msg }) => msg)).toContain("request");
    });
  });
});

describe("upstream tools", () => {
  const upstreamTypeDefs = 'type Query { value: String } type Thing @key(fields: "id") { id: ID! }';

  it("[FR-SG-7] gives resolvers an upstream that retries without waiting in tests", async () => {
    const responses = [new Response("{}", { status: 503 }), Response.json({ value: "ok" })];
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(responses.shift() as Response),
    );
    running = createSubgraph(
      {
        name: "test",
        typeDefs: upstreamTypeDefs,
        resolvers: ({ upstream }) => {
          const source = upstream("example");
          return {
            Query: {
              value: async () => {
                const found = await source.call({
                  key: "value",
                  policy: () => ({ freshSeconds: 1, staleSeconds: 1 }),
                  stored: z.object({ value: z.string() }),
                  request: { url: "https://example.org", schema: z.object({ value: z.string() }) },
                });
                return found?.value;
              },
            },
          };
        },
      },
      { env: quick, fetch, sleep: () => Promise.resolve(), signals: new EventEmitter() },
    );
    const url = `http://127.0.0.1:${await running.listen()}`;

    expect((await query(url, { query: "{ value }" })).data?.value).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("[FR-SG-6] refuses more entities than the router would ever send", async () => {
    const url = await start();
    const representations = Array.from({ length: 501 }, (_, id) => ({ __typename: "Thing", id }));

    const result = await query(url, {
      query: "query Q($r: [_Any!]!) { _entities(representations: $r) { ... on Thing { id } } }",
      variables: { r: representations },
    });

    expect(result.errors?.[0]).toMatchObject({
      message: "Too many entities in one request.",
      extensions: { code: "BAD_USER_INPUT" },
    });
  });

  it("[FR-SG-6] counts entities across aliases, so they can't get around the limit", async () => {
    const url = await start();
    const batch = (from: number) =>
      Array.from({ length: 300 }, (_, id) => ({ __typename: "Thing", id: from + id }));

    const result = await query(url, {
      query: `query Q($a: [_Any!]!, $b: [_Any!]!) {
        a: _entities(representations: $a) { ... on Thing { id } }
        b: _entities(representations: $b) { ... on Thing { id } }
      }`,
      variables: { a: batch(0), b: batch(300) },
    });

    expect(result.errors?.[0]?.message).toBe("Too many entities in one request.");
  });

  it("[FR-SG-6] allows a batch of entities the router could send", async () => {
    const url = await start();
    const representations = Array.from({ length: 500 }, (_, id) => ({ __typename: "Thing", id }));

    const result = await query(url, {
      query: "query Q($r: [_Any!]!) { _entities(representations: $r) { ... on Thing { id } } }",
      variables: { r: representations },
    });

    expect(result.errors).toBeUndefined();
  });

  it("[FR-SG-7] starts a subgraph with no entities", async () => {
    running = createSubgraph(
      {
        name: "test",
        typeDefs: "type Query { a: String }",
        resolvers: { Query: { a: () => "a" } },
      },
      { env: quick, signals: new EventEmitter() },
    );
    const url = `http://127.0.0.1:${await running.listen()}`;

    expect((await query(url, { query: "{ a }" })).data?.a).toBe("a");
  });

  it("[FR-SG-6] connects to Redis when REDIS_URL is set, and closes it on shutdown", async () => {
    const redis = await hangingRedis();
    running = createSubgraph(
      { name: "test", typeDefs, resolvers },
      { env: { ...quick, REDIS_URL: redis.url }, signals: new EventEmitter() },
    );
    await running.listen();
    await new Promise((resolve) => setTimeout(resolve, 200));
    let closed = false;
    void redis.closed.then(() => (closed = true));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(closed).toBe(false);

    await running.shutdown();

    await vi.waitFor(() => {
      expect(closed).toBe(true);
    });
    redis.server.close();
  });

  it.each(["http://cache", "not a url", "redis://cache.example.com"])(
    "[FR-SG-6] refuses REDIS_URL=%j",
    (REDIS_URL) => {
      expect(() =>
        createSubgraph({ name: "test", typeDefs, resolvers }, { env: { REDIS_URL } }),
      ).toThrow(/REDIS_URL/);
    },
  );

  it.each(["rediss://cache.example.com", "redis://cache", "redis://127.0.0.1:6379"])(
    "[FR-SG-6] accepts REDIS_URL=%j",
    (REDIS_URL) => {
      expect(() =>
        createSubgraph({ name: "test", typeDefs, resolvers }, { env: { REDIS_URL } }),
      ).not.toThrow();
    },
  );
});

describe("configuration", () => {
  const create = (env: Record<string, string>) => () =>
    createSubgraph({ name: "test", typeDefs, resolvers }, { env });

  it.each(["not-a-port", "", "70000"])("[FR-SG-7] refuses PORT=%j before it starts", (PORT) => {
    expect(create({ PORT })).toThrow(/PORT/);
  });

  it("[FR-SG-7] refuses an empty drain time, which would skip the drain", () => {
    expect(create({ SHUTDOWN_DRAIN_MS: "" })).toThrow(/SHUTDOWN_DRAIN_MS/);
  });

  it.each([
    ["JWKS_URL", { JWT_AUDIENCE: "traverse", JWT_ISSUER: issuer }],
    ["JWT_AUDIENCE", { JWKS_URL: auth.JWKS_URL, JWT_ISSUER: issuer }],
    ["JWT_ISSUER", { JWKS_URL: auth.JWKS_URL, JWT_AUDIENCE: "traverse" }],
  ])("[GR-3] refuses partial auth settings, with no %s", (_, env) => {
    expect(create(env)).toThrow(/go together/);
  });

  it.each(["http://keys.example.com/jwks.json", "file:///etc/passwd", "not a url"])(
    "[GR-3] refuses keys from %s",
    (JWKS_URL) => {
      expect(create({ ...auth, JWKS_URL })).toThrow(/JWKS_URL/);
    },
  );

  it.each(["https://keys.example.com/jwks.json", "http://keys/jwks.json"])(
    "[FR-SG-7] accepts keys from %s",
    (JWKS_URL) => {
      expect(create({ ...auth, JWKS_URL })).not.toThrow();
    },
  );

  it("[FR-SG-7] uses the process's own environment and signals by default", async () => {
    vi.stubEnv("SHUTDOWN_DRAIN_MS", "0");
    const before = process.listenerCount("SIGTERM");
    const subgraph = createSubgraph({ name: "test", typeDefs, resolvers });
    running = subgraph;

    await subgraph.listen(0);

    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    await subgraph.shutdown();
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });
});
