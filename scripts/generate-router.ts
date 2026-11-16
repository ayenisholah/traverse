import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { composeGraph } from "@traverse/graph-core";
import { generateTypedOperations, persistedOperation } from "@traverse/typed-operations";
import { parse } from "yaml";

/**
 * Writes the router's persisted operations, the app's typed operations and the execution config.
 * Run it after changing an operation in router/operations or a subgraph's schema. It needs Docker.
 */
const WGC = "wgc@0.133.6";
const NODE_IMAGE = "node:24";
const sources = "router/operations";
const persisted = "router/persisted/operations";
const typed = "apps/web/src/generated/operations.ts";

const documents = readdirSync(sources)
  .filter((name) => name.endsWith(".graphql"))
  .map((file) => ({ file, body: readFileSync(join(sources, file), "utf8") }));

rmSync(persisted, { recursive: true, force: true });
mkdirSync(persisted, { recursive: true });
for (const { body } of documents) {
  const { file, content } = persistedOperation(body);
  writeFileSync(join(persisted, file), content);
}

// The app's types come from the same documents and the same schemas, so it can't send an operation
// the router doesn't hold. A document that doesn't fit the schema stops here (FR-WB-12).
interface GraphInput {
  subgraphs: { name: string; schema: { file: string } }[];
}
const input = parse(readFileSync("router/graph.yaml", "utf8")) as GraphInput;
const graph = composeGraph(
  input.subgraphs.map(({ name, schema }) => ({
    name,
    sdl: readFileSync(join(dirname("router/graph.yaml"), schema.file), "utf8"),
  })),
);
if (!graph.success) throw new Error(graph.errors.join("\n"));
writeFileSync(typed, await generateTypedOperations(graph.sdl, documents));

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
