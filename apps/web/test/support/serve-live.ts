import { PackageOperation } from "../../src/generated/operations.ts";
import { startStubRouter, startWebServer } from "./live-server.ts";

// Playwright's web server for the server build: the app, with a stub router behind it.
const port = Number(process.argv[2]);
const router = await startStubRouter(PackageOperation.sha256);
const server = startWebServer(port, { PUBLIC_ROUTER_URL: router.url });

const stop = () => {
  router.stop();
  void server.stop();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.exitCode = (await server.exited) ?? 1;
router.stop();
