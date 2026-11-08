import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Writes the router's persisted operations and execution config. Run it after changing an
 * operation in router/operations or a subgraph's schema. It needs Docker.
 */
const WGC = "wgc@0.133.6";
const NODE_IMAGE = "node:24";
const sources = "router/operations";
const persisted = "router/persisted/operations";

// The router looks an operation up by the SHA-256 of its body (C-34).
rmSync(persisted, { recursive: true, force: true });
mkdirSync(persisted, { recursive: true });
for (const file of readdirSync(sources).filter((name) => name.endsWith(".graphql"))) {
  const body = readFileSync(join(sources, file), "utf8");
  const hash = createHash("sha256").update(body).digest("hex");
  writeFileSync(join(persisted, `${hash}.json`), `${JSON.stringify({ version: 1, body })}\n`);
}

// wgc only runs here, in a container with no network, so its telemetry and update check can't
// reach anything, and it never becomes a dependency of the project (C-31).
const user = `${String(process.getuid?.())}:${String(process.getgid?.())}`;
const install = mkdtempSync(join(tmpdir(), "wgc-"));
const docker = (args: string[]) => execFileSync("docker", ["run", "--rm", "-u", user, ...args]);
try {
  docker([
    ...["-e", "npm_config_cache=/opt/wgc/.npm", "-v", `${install}:/opt/wgc`, NODE_IMAGE],
    ...["npm", "install", "--silent", "--ignore-scripts", "--prefix", "/opt/wgc", WGC],
  ]);
  docker([
    ...["--network", "none", "-e", "DISABLE_UPDATE_CHECK=true"],
    ...["-v", `${install}:/opt/wgc:ro`, "-v", `${resolve(".")}:/w`, "-w", "/w", NODE_IMAGE],
    ...["node", "/opt/wgc/node_modules/wgc/dist/src/index.js", "router", "compose"],
    ...["-i", "router/graph.yaml", "-o", "router/config.json"],
  ]);
} finally {
  rmSync(install, { recursive: true, force: true });
}
