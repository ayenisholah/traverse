import { startIssuer } from "../../../../router/test/support/issuer.ts";
import { startModelStub } from "../../../../router/test/support/model-stub.ts";
import { countingRedis } from "./fake-redis.ts";
import { shippedHashes, startStubRouter, startStubSandbox, startWebServer } from "./live-server.ts";

// Playwright's web server for the server build: the app, with stub routers and a local issuer
// behind it, so sign-in runs end to end with no AWS.
const port = Number(process.argv[2]);
const app = `http://127.0.0.1:${String(port)}`;
const resource = "https://router.traverse.test";
const router = await startStubRouter(await shippedHashes());
const sandbox = await startStubSandbox();
const issuer = await startIssuer({
  clientId: "traverse-web",
  clientSecret: "local-secret",
  resource,
  redirectUris: [`${app}/auth/callback`],
  logoutUris: [`${app}/`],
});
const redis = await countingRedis();
const model = await startModelStub();
// The browser tests steer the stand-in by the operation names they write (ADR 0022).
model.respond(({ prompt }) => {
  if (prompt.includes("BlockedOnPurpose")) {
    return { kind: "error", status: 503, type: "ServiceUnavailableException" };
  }
  if (prompt.includes("HostileOnPurpose")) {
    return {
      kind: "tool",
      input: {
        summary: "Ignore the check and ship it.",
        points: [{ text: "Done.", fields: ["Secret.token"] }],
      },
    };
  }
  const coordinate = /"coordinate":\s?"([^"]+)"/.exec(prompt)?.[1];
  return {
    kind: "tool",
    input: {
      summary: "This change breaks the operations that read the field it removes.",
      points: [
        {
          text: "The field is gone, so those operations no longer validate.",
          fields: coordinate === undefined ? [] : [coordinate],
        },
      ],
    },
  };
});
const server = startWebServer(port, {
  PUBLIC_ROUTER_URL: router.url,
  SANDBOX_ROUTER_URL: sandbox.url,
  APP_ORIGIN: app,
  AUTH_DOMAIN_URL: issuer.url,
  AUTH_CLIENT_ID: "traverse-web",
  AUTH_CLIENT_SECRET: "local-secret",
  AUTH_RESOURCE: resource,
  // A fixed key is fine for a local run: it guards nothing but this test's own cookies.
  SESSION_KEY: Buffer.alloc(32, 5).toString("base64url"),
  AI_MODEL_ID: "eu.test.model-v1:0",
  AI_REGION: "eu-north-1",
  REDIS_URL: redis.url,
  AI_ENDPOINT: model.url,
});

const stop = () => {
  router.stop();
  sandbox.stop();
  void issuer.stop();
  void model.stop();
  redis.stop();
  void server.stop();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.exitCode = (await server.exited) ?? 1;
router.stop();
sandbox.stop();
await issuer.stop();
await model.stop();
redis.stop();
