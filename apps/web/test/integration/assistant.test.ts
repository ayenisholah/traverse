import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startIssuer, type Issuer } from "../../../../router/test/support/issuer.ts";
import { startModelStub, type ModelStub } from "../../../../router/test/support/model-stub.ts";
import { countingRedis } from "../support/fake-redis.ts";
import {
  freePort,
  shippedHashes,
  startStubRouter,
  startStubSandbox,
  startWebServer,
  waitUntilReady,
  type StubRouter,
  type StubSandbox,
  type WebServer,
} from "../support/live-server.ts";
import { signInOverHttp } from "../support/sign-in.ts";

// Built from parts, so the source holds nothing a secret scanner takes for a real token.
const PLANTED_TOKEN = [
  "eyJhbGciOiJSUzI1NiJ9",
  "eyJzdWIiOiJ0ZXN0LXBsYW50ZWQifQ",
  "c2lnbmF0dXJl",
].join(".");
const PLANTED_EMAIL = "test-planted-maintainer@example.com";
const ANSWER = "Two subgraphs define Mood.name differently.";

let issuer: Issuer;
let model: ModelStub;
let redis: Awaited<ReturnType<typeof countingRedis>>;
let router: StubRouter;
let sandbox: StubSandbox;
let web: WebServer;

// Needs `npm run build:server` first: this runs the built app, as a deployment would.
beforeAll(async () => {
  const port = await freePort();
  const app = `http://127.0.0.1:${String(port)}`;
  issuer = await startIssuer({
    clientId: "traverse-web",
    clientSecret: "test-client-secret",
    resource: "https://router.traverse.test",
    redirectUris: [`${app}/auth/callback`],
    logoutUris: [`${app}/`],
  });
  model = await startModelStub();
  redis = await countingRedis();
  router = await startStubRouter(await shippedHashes());
  sandbox = await startStubSandbox();
  web = startWebServer(port, {
    PUBLIC_ROUTER_URL: router.url,
    SANDBOX_ROUTER_URL: sandbox.url,
    APP_ORIGIN: app,
    AUTH_DOMAIN_URL: issuer.url,
    AUTH_CLIENT_ID: "traverse-web",
    AUTH_CLIENT_SECRET: "test-client-secret",
    AUTH_RESOURCE: "https://router.traverse.test",
    SESSION_KEY: Buffer.alloc(32, 3).toString("base64url"),
    AI_MODEL_ID: "eu.test.model-v1:0",
    AI_REGION: "eu-north-1",
    REDIS_URL: redis.url,
    AI_ENDPOINT: model.url,
  });
  await waitUntilReady(web);
}, 120_000);

afterAll(async () => {
  await web.stop();
  await model.stop();
  await issuer.stop();
  redis.stop();
  router.stop();
  sandbox.stop();
});

const explain = async (cookie: string) => {
  const response = await fetch(`${web.url}/api/trpc/explain`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      kind: "composition",
      failed: "proposed",
      errors: [
        `Field "Mood.name" is defined twice. Ask ${PLANTED_EMAIL}, or use token ${PLANTED_TOKEN}.`,
      ],
    }),
  });
  return (await response.json()) as { result?: { data?: Record<string, unknown> } };
};

describe("the built server's assistant", { timeout: 60_000 }, () => {
  it("[GR-14] sends no planted email or token to the model, and writes nothing of a call", async () => {
    const cookie = await signInOverHttp(web.url, issuer.url, "test-gr14");
    model.reply({
      kind: "tool",
      input: { summary: ANSWER, points: [{ text: "Mood.name differs.", fields: ["Mood.name"] }] },
    });
    const answered = await explain(cookie);
    model.reply({ kind: "error", status: 500, type: "InternalServerException" });
    const failed = await explain(cookie);

    expect(answered.result?.data).toMatchObject({ kind: "explained", summary: ANSWER });
    expect(failed.result?.data).toEqual({ kind: "unavailable" });
    for (const call of model.calls) {
      expect(call.prompt).toContain("Mood.name");
      expect(call.prompt).not.toContain(PLANTED_EMAIL);
      expect(call.prompt).not.toContain(PLANTED_TOKEN);
    }
    const output = web.output();
    for (const kept of [PLANTED_EMAIL, PLANTED_TOKEN, ANSWER, "material to analyse", "Mood.name"]) {
      expect(output).not.toContain(kept);
    }
  });
});
