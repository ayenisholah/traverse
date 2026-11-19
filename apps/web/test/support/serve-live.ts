import { startIssuer } from "../../../../router/test/support/issuer.ts";
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
});

const stop = () => {
  router.stop();
  sandbox.stop();
  void issuer.stop();
  void server.stop();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.exitCode = (await server.exited) ?? 1;
router.stop();
sandbox.stop();
await issuer.stop();
