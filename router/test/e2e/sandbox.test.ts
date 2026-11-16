import { once } from "node:events";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startSandboxRouter, startStack, type Router, type Stack } from "../support/stack.ts";

interface GraphqlResponse {
  data?: Record<string, unknown> | null;
  errors?: { message: string }[];
  extensions?: { queryPlan?: unknown };
}

const post = async (url: string, body: unknown, headers: Record<string, string> = {}) => {
  const response = await fetch(`${url}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) as GraphqlResponse };
};

/** The status a WebSocket upgrade gets, or "upgraded" if the router accepts it. */
const upgradeStatus = async (url: string): Promise<number | string | undefined> => {
  const upgrade = request(`${url}/graphql`, {
    headers: {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-version": "13",
      // Any 16 bytes will do. Built here, because a secret scanner reads the literal as a key.
      "sec-websocket-key": Buffer.from("the sample nonce").toString("base64"),
      "sec-websocket-protocol": "graphql-transport-ws",
    },
  }).end();
  const outcome = await Promise.race([
    once(upgrade, "upgrade").then(() => "upgraded"),
    once(upgrade, "response").then(([response]) => (response as IncomingMessage).statusCode),
  ]);
  upgrade.destroy();
  return outcome;
};

const isRefused = async (host: string, port: number): Promise<boolean> => {
  const socket = connect({ host, port });
  const [outcome] = (await Promise.race([
    once(socket, "error"),
    once(socket, "connect").then(() => ["connected"]),
  ])) as [Error | string];
  socket.destroy();
  return String(outcome).includes("ECONNREFUSED");
};

const MUTATION = `mutation Add { addNote(text: "x") }`;
const HOSTILE_PORT = 3905;

// A graph with a mutation and a subscription, which the real graph doesn't have yet. Its one
// subgraph is a stand-in that answers anything and records what it was sent, so a test can tell
// an operation the router refused from one that reached a subgraph and failed there.
describe("the sandbox router on a graph that has writes", { timeout: 60_000 }, () => {
  let subgraph: Server;
  let sandbox: Router;
  const received: string[] = [];

  beforeAll(async () => {
    subgraph = createServer((request, response) => {
      let text = "";
      request.on("data", (chunk: Buffer) => (text += chunk.toString()));
      request.on("end", () => {
        received.push(text);
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ data: { note: "hello", addNote: true } }));
      });
    }).listen(4104, "127.0.0.1");
    await once(subgraph, "listening");
    sandbox = await startSandboxRouter({
      executionConfig: "test/fixtures/sandbox-graph/config.json",
    });
  }, 180_000);

  afterAll(async () => {
    await sandbox.stop();
    subgraph.close();
  });

  it("[FR-GW-9] runs a free-form read and returns its query plan", async () => {
    const before = received.length;
    const { json } = await post(sandbox.url, { query: "query Note { note }" });

    expect(json.data).toEqual({ note: "hello" });
    expect(json.extensions?.queryPlan).toMatchObject({
      kind: "Single",
      fetch: { kind: "Single", subgraphName: "notes" },
    });
    // Proves the stand-in does see what the router sends, which the tests below rely on.
    expect(received.length).toBe(before + 1);
  });

  it("[GR-11] refuses a mutation before it reaches a subgraph", async () => {
    const before = received.length;
    const { json } = await post(sandbox.url, { query: MUTATION });

    expect(json.data ?? null).toBeNull();
    expect(json.errors?.[0]?.message).toBe("operation type 'mutation' is blocked");
    expect(received.length).toBe(before);
  });

  it("[GR-4] keeps a GET's operation and variables out of its log", async () => {
    const query = encodeURIComponent(`query Sentinel { note # planted-in-query\n}`);
    const variables = encodeURIComponent(JSON.stringify({ secret: "planted-in-variables" }));
    const response = await fetch(`${sandbox.url}/graphql?query=${query}&variables=${variables}`);
    await response.text();
    // The access log line is written just after the answer.
    await new Promise((done) => setTimeout(done, 500));

    expect(sandbox.logs()).toContain('"path":"/graphql"');
    expect(sandbox.logs()).not.toMatch(/planted-in-query|planted-in-variables|Sentinel/);
  });

  it("[GR-11] refuses a mutation sent as a GET, as the router does for any mutation", async () => {
    const before = received.length;
    const response = await fetch(`${sandbox.url}/graphql?query=${encodeURIComponent(MUTATION)}`);

    expect(response.status).toBe(405);
    expect(received.length).toBe(before);
  });

  it("[GR-11] refuses a mutation hidden behind a read in the same document", async () => {
    const before = received.length;
    const { json } = await post(sandbox.url, {
      query: `query Note { note } ${MUTATION}`,
      operationName: "Add",
    });

    expect(json.errors?.[0]?.message).toBe("operation type 'mutation' is blocked");
    expect(received.length).toBe(before);
  });

  it("[GR-11] refuses a subscription over server-sent events", async () => {
    const before = received.length;
    const response = await fetch(`${sandbox.url}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ query: "subscription Notes { noteAdded }" }),
      signal: AbortSignal.timeout(10_000),
    });

    expect(await response.text()).toContain("operation type 'subscription' is blocked");
    expect(received.length).toBe(before);
  });

  it("[GR-11] opens no WebSocket", async () => {
    expect(await upgradeStatus(sandbox.url)).toBe(400);
  });

  it("[GR-11] refuses a batch, so one request is one operation", async () => {
    const before = received.length;
    const response = await fetch(`${sandbox.url}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ query: "{ note }" }, { query: MUTATION }]),
    });

    expect(await response.text()).not.toContain('"note":"hello"');
    expect(received.length).toBe(before);
  });

  it("[GR-11] hands out no schema and no playground", async () => {
    const { json } = await post(sandbox.url, { query: "{ __schema { queryType { name } } }" });
    const page = await fetch(`${sandbox.url}/`, { headers: { accept: "text/html" } });

    expect(json.data?.__schema ?? null).toBeNull();
    expect(json.errors?.[0]?.message).toMatch(/introspection is disabled/);
    expect(await page.text()).not.toMatch(/playground|graphiql/i);
  });

  it("[GR-11] allows no origin, because no browser calls it", async () => {
    const response = await fetch(`${sandbox.url}/graphql`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("[GR-11] answers on loopback only, so nothing on the network can reach it", async () => {
    const outside = Object.values(networkInterfaces())
      .flat()
      .find((address) => address?.family === "IPv4" && !address.internal)?.address;
    // Without another address there's nothing to test, and a pass would mean nothing.
    if (outside === undefined) throw new Error("This machine has no address besides loopback");

    expect(await isRefused(outside, Number(new URL(sandbox.url).port))).toBe(true);
    // Proves the check can tell an open port from a closed one.
    expect(await isRefused("127.0.0.1", Number(new URL(sandbox.url).port))).toBe(false);
  });

  it("[GR-11] still refuses writes when the environment tries to allow them", async () => {
    // A deployment may not set these (findUnsafeSandboxEnvironment refuses each). This proves
    // that even if one slipped through, the file's literal settings win (C-50).
    const hostile = await startSandboxRouter({
      executionConfig: "test/fixtures/sandbox-graph/config.json",
      port: HOSTILE_PORT,
      hostileEnv: {
        SECURITY_BLOCK_MUTATIONS_ENABLED: "false",
        SECURITY_BLOCK_MUTATIONS_CONDITION: "false",
        SECURITY_BLOCK_SUBSCRIPTIONS_ENABLED: "false",
        SECURITY_BLOCK_SUBSCRIPTIONS_CONDITION: "false",
        DEV_MODE: "true",
        INTROSPECTION_ENABLED: "true",
        PLAYGROUND_ENABLED: "true",
        WEBSOCKETS_ENABLED: "true",
        BATCHING_ENABLED: "true",
        CORS_ENABLED: "true",
        CORS_ALLOW_ORIGINS: "*",
        MCP_ENABLED: "true",
      },
    });
    try {
      const before = received.length;
      const mutation = await post(hostile.url, { query: MUTATION });
      const schema = await post(hostile.url, { query: "{ __schema { queryType { name } } }" });
      const cors = await fetch(`${hostile.url}/graphql`, {
        method: "OPTIONS",
        headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
      });

      const page = await fetch(`${hostile.url}/`, { headers: { accept: "text/html" } });
      const batch = await fetch(`${hostile.url}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ query: "{ note }" }]),
      });

      expect(mutation.json.errors?.[0]?.message).toBe("operation type 'mutation' is blocked");
      expect(schema.json.errors?.[0]?.message).toMatch(/introspection is disabled/);
      expect(cors.headers.get("access-control-allow-origin")).toBeNull();
      // DEV_MODE and PLAYGROUND_ENABLED would serve a playground, and BATCHING_ENABLED a batch.
      expect(await page.text()).not.toMatch(/playground|graphiql/i);
      expect(await batch.text()).not.toContain('"note":"hello"');
      expect(await upgradeStatus(hostile.url)).toBe(400);
      // MCP_ENABLED would open the MCP server's own port.
      expect(await isRefused("127.0.0.1", 5025)).toBe(true);
      expect(received.length).toBe(before);
    } finally {
      await hostile.stop();
    }
  });
});

const PACKAGE = `query Explore($name: String!) {
  package(name: $name) {
    name
    repository { stars }
    advisories { id }
  }
}`;

describe("the sandbox router on the real graph", { timeout: 60_000 }, () => {
  let stack: Stack;
  let sandbox: Router;

  beforeAll(async () => {
    stack = await startStack();
    sandbox = await stack.startSandbox();
  }, 240_000);

  afterAll(async () => {
    await sandbox.stop();
    await stack.stop();
  });

  it("[FR-GW-9] runs a free-form read across the three subgraphs and returns the plan", async () => {
    const { json, text } = await post(sandbox.url, {
      query: PACKAGE,
      variables: { name: "express" },
    });

    expect(json.errors).toBeUndefined();
    expect(json.data).toMatchObject({ package: { name: "express" } });
    for (const subgraph of ["packages", "repositories", "advisories"]) {
      expect(text).toContain(`"subgraphName":"${subgraph}"`);
    }
  });

  it("[GR-1] leaves the public router refusing the same operation, and returning no plan", async () => {
    const { json, text } = await post(stack.url, {
      query: PACKAGE,
      variables: { name: "express" },
    });

    expect(json.data ?? null).toBeNull();
    expect(text).not.toMatch(/queryPlan/i);
  });

  it("[FR-GW-9] holds a free-form operation to the public router's limits", async () => {
    const aliases = await post(sandbox.url, {
      query: `{ a: package(name: "express") { name } b: package(name: "ms") { name } }`,
    });
    const roots = await post(sandbox.url, {
      query: `{ package(name: "express") { name } __typename }`,
    });

    expect(aliases.status).toBe(400);
    expect(aliases.json.data ?? null).toBeNull();
    expect(roots.json.errors ?? []).toEqual([]);
  });
});
