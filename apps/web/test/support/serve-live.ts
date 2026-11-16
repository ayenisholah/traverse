import { PackageOperation } from "../../src/generated/operations.ts";
import { startStubRouter, startStubSandbox, startWebServer } from "./live-server.ts";

// Playwright's web server for the server build: the app, with stub routers behind it.
const port = Number(process.argv[2]);
const router = await startStubRouter(PackageOperation.sha256);
const sandbox = await startStubSandbox();
const server = startWebServer(port, {
  PUBLIC_ROUTER_URL: router.url,
  SANDBOX_ROUTER_URL: sandbox.url,
});

const stop = () => {
  router.stop();
  sandbox.stop();
  void server.stop();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.exitCode = (await server.exited) ?? 1;
router.stop();
sandbox.stop();
