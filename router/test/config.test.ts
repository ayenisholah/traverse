import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findBannedRouterSettings, findUnknownRouterVariables } from "@traverse/repo-checks";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (path: string) => readFileSync(path, "utf8");
const publicConfig = () => parse(read("router/config.yaml")) as Record<string, unknown>;

describe("the public router's config", () => {
  it("[GR-1] enables no dev mode, playground, introspection, query plans or wildcard CORS", () => {
    expect(findBannedRouterSettings(publicConfig())).toEqual([]);
  });

  it("[GR-1] uses only variables the environment check holds to a format", () => {
    expect(findUnknownRouterVariables(read("router/config.yaml"))).toEqual([]);
  });

  it("[GR-2] runs persisted operations only", () => {
    expect(publicConfig()).toMatchObject({
      security: { block_non_persisted_operations: { enabled: true } },
      persisted_operations: { storage: { provider_id: "operations" } },
    });
  });

  it("[GR-1] would fail if a banned setting were planted in it", () => {
    const planted = { ...publicConfig(), dev_mode: true, playground_enabled: true };

    expect(findBannedRouterSettings(planted)).toEqual(["dev_mode", "playground_enabled"]);
  });
});

interface ExecutionConfig {
  subgraphs: { name: string; routingUrl: string }[];
  engineConfig: {
    datasourceConfigurations: { customGraphql: { federation: { serviceSdl: string } } }[];
  };
}

interface GraphInput {
  subgraphs: { name: string; routing_url: string; schema: { file: string } }[];
}

describe("generated router files", () => {
  const execution = JSON.parse(read("router/config.json")) as ExecutionConfig;
  const input = parse(read("router/graph.yaml")) as GraphInput;

  it.each(input.subgraphs.map((subgraph, index) => [subgraph.name, subgraph, index] as const))(
    "[FR-SG-5] compose the current %s schema; run npm run generate:router if this fails",
    (name, subgraph, index) => {
      const composed = execution.subgraphs[index];
      const sdl =
        execution.engineConfig.datasourceConfigurations[index]?.customGraphql.federation.serviceSdl;

      expect(composed).toEqual(expect.objectContaining({ name, routingUrl: subgraph.routing_url }));
      expect(sdl).toBe(read(join("router", subgraph.schema.file)));
    },
  );

  it("[GR-2] hold exactly the operations in router/operations; run npm run generate:router if this fails", () => {
    const expected = readdirSync("router/operations")
      .filter((file) => file.endsWith(".graphql"))
      .map((file) => {
        const body = read(join("router/operations", file));
        return { file: `${createHash("sha256").update(body).digest("hex")}.json`, body };
      });
    const persisted = readdirSync("router/persisted/operations").map((file) => ({
      file,
      body: (JSON.parse(read(join("router/persisted/operations", file))) as { body: string }).body,
    }));

    expect(persisted).toEqual(expect.arrayContaining(expected));
    expect(persisted).toHaveLength(expected.length);
  });
});
