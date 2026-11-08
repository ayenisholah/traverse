import { describe, expect, it } from "vitest";
import {
  findBannedRouterSettings,
  findUnknownRouterVariables,
  findUnsafeRouterEnvironment,
} from "../src/index.ts";

/** The smallest config that passes: every setting the environment could change, set safely. */
const safe = (): Record<string, unknown> => ({
  dev_mode: false,
  demo_mode: false,
  introspection: { enabled: false },
  introspection_enabled: false,
  playground: { enabled: false },
  playground_enabled: false,
  query_plans_enabled: false,
  engine: { debug: { always_include_query_plan: false } },
  cors: { allow_origins: ["https://traverse.example"], match_origins: [] },
  security: { block_non_persisted_operations: { enabled: true, condition: "true" } },
  persisted_operations: { disabled: false },
  automatic_persisted_queries: { enabled: false },
  mcp: { enabled: false },
  connect_rpc: { enabled: false },
  authentication: { jwt: { on_error: "reject" } },
});

const SETTINGS = [
  "dev_mode",
  "demo_mode",
  "introspection.enabled",
  "introspection_enabled",
  "playground.enabled",
  "playground_enabled",
  "query_plans_enabled",
  "engine.debug.always_include_query_plan",
  "cors.allow_origins",
  "cors.match_origins",
  "security.block_non_persisted_operations.enabled",
  "security.block_non_persisted_operations.condition",
  "persisted_operations.disabled",
  "automatic_persisted_queries.enabled",
  "mcp.enabled",
  "connect_rpc.enabled",
  "authentication.jwt.on_error",
];

/** Sets one dotted setting in a copy of the safe config, or removes it when value is undefined. */
const withSetting = (setting: string, value: unknown) => {
  const config = structuredClone(safe());
  const keys = setting.split(".");
  const last = keys.pop() as string;
  const parent = keys.reduce((node, key) => node[key] as Record<string, unknown>, config);
  if (value === undefined) delete parent[last];
  else parent[last] = value;
  return config;
};

describe("findBannedRouterSettings", () => {
  it("[GR-1] accepts a config that sets every setting safely", () => {
    expect(findBannedRouterSettings(safe())).toEqual([]);
  });

  it.each([
    ["dev mode", "dev_mode", true],
    ["demo mode", "demo_mode", true],
    ["introspection", "introspection.enabled", true],
    ["the deprecated introspection key", "introspection_enabled", true],
    ["the playground", "playground.enabled", true],
    ["the deprecated playground key", "playground_enabled", true],
    ["query plans", "query_plans_enabled", true],
    ["a query plan on every response", "engine.debug.always_include_query_plan", true],
    ["a wildcard origin", "cors.allow_origins", ["*"]],
    ["a wildcard inside an origin", "cors.allow_origins", ["https://*.example"]],
    ["an origin that isn't one", "cors.allow_origins", ["https://a.example/path"]],
    ["an origin that isn't text", "cors.allow_origins", [1]],
    ["no origins", "cors.allow_origins", []],
    ["an origin pattern", "cors.match_origins", [".*"]],
    ["non-persisted operations", "security.block_non_persisted_operations.enabled", false],
    [
      "a condition that could let non-persisted operations through",
      "security.block_non_persisted_operations.condition",
      "false",
    ],
    ["persisted operations turned off", "persisted_operations.disabled", true],
    ["operations registered by clients", "automatic_persisted_queries.enabled", true],
    ["the MCP server, which can hand out the schema", "mcp.enabled", true],
    ["the ConnectRPC server", "connect_rpc.enabled", true],
    ["a bad token passed on as anonymous", "authentication.jwt.on_error", "pass"],
  ])("[GR-1] refuses %s", (_, setting, value) => {
    expect(findBannedRouterSettings(withSetting(setting, value))).toEqual([setting]);
  });

  // The router reads its environment first and lays the file on top, so a key the file leaves
  // out still takes its environment variable: APQ_ENABLED, MCP_ENABLED, CORS_MATCH_ORIGINS...
  it.each(SETTINGS)("[GR-1] refuses a config that leaves %s to the environment", (setting) => {
    expect(findBannedRouterSettings(withSetting(setting, undefined))).toEqual([setting]);
  });

  it("[GR-1] refuses a variable where a literal belongs", () => {
    expect(findBannedRouterSettings(withSetting("dev_mode", "${DEV_MODE}"))).toEqual(["dev_mode"]);
  });

  it("[GR-1] accepts the one origin variable, which the environment check holds to a format", () => {
    const config = withSetting("cors.allow_origins", ["${ROUTER_CORS_ORIGIN}"]);

    expect(findBannedRouterSettings(config)).toEqual([]);
  });

  it("[GR-1] reports every banned setting at once", () => {
    expect(findBannedRouterSettings({})).toEqual(SETTINGS);
  });

  it.each([null, "dev_mode: true", 1, []])("[GR-1] refuses %j, which isn't a config", (config) => {
    expect(findBannedRouterSettings(config)).toEqual(["(the config itself)"]);
  });
});

describe("findUnknownRouterVariables", () => {
  it("[GR-1] accepts the variables the environment check knows", () => {
    expect(findUnknownRouterVariables("a: ${ROUTER_LISTEN_ADDR}\nb: ${ROUTER_JWKS_URL}")).toEqual(
      [],
    );
  });

  it("[GR-1] names any other variable, which could carry new keys into the config", () => {
    expect(findUnknownRouterVariables("a: ${APQ}\nb: $MCP\nc: ${ROUTER_LISTEN_ADDR}")).toEqual([
      "APQ",
      "MCP",
    ]);
  });
});

const environment = (): Record<string, string> => ({
  CONFIG_PATH: "/config/config.yaml",
  ROUTER_LISTEN_ADDR: "0.0.0.0:3002",
  ROUTER_CORS_ORIGIN: "https://traverse.example",
  ROUTER_EXECUTION_CONFIG: "/config/config.json",
  ROUTER_OPERATIONS_DIR: "/files/persisted",
  ROUTER_JWKS_URL: "https://auth.traverse.example/.well-known/jwks.json",
  ROUTER_JWT_AUDIENCE: "traverse-router",
});

describe("findUnsafeRouterEnvironment", () => {
  it("[GR-1] accepts a deployment's environment of known, well-formed values", () => {
    expect(findUnsafeRouterEnvironment(environment())).toEqual([]);
  });

  it("[GR-1] accepts a local token issuer and origin", () => {
    const local = {
      ...environment(),
      ROUTER_CORS_ORIGIN: "http://127.0.0.1:3000",
      ROUTER_JWKS_URL: "http://127.0.0.1:41234/jwks.json",
    };

    expect(findUnsafeRouterEnvironment(local)).toEqual([]);
  });

  it.each([
    ["a router setting", "APQ_ENABLED", "true"],
    ["an MCP setting", "MCP_ENABLED", "true"],
    ["a CORS setting", "CORS_MATCH_ORIGINS", ".*"],
    ["a block condition", "SECURITY_BLOCK_NON_PERSISTED_OPERATIONS_CONDITION", "false"],
  ])("[GR-1] refuses %s, which the router would read", (_, name, value) => {
    expect(findUnsafeRouterEnvironment({ ...environment(), [name]: value })).toEqual([name]);
  });

  it.each([
    ["CONFIG_PATH", "/config/config.yaml,/tmp/override.yaml"],
    ["CONFIG_PATH", "config.yaml"],
    ["ROUTER_CORS_ORIGIN", '"*"'],
    ["ROUTER_CORS_ORIGIN", "http://traverse.example"],
    ["ROUTER_CORS_ORIGIN", "https://traverse.example/"],
    ["ROUTER_LISTEN_ADDR", "0.0.0.0:3002\nmcp:\n  enabled: true"],
    ["ROUTER_JWKS_URL", "http://auth.traverse.example/jwks.json"],
    ["ROUTER_JWKS_URL", "https://auth.example/jwks.json #"],
    ["ROUTER_JWT_AUDIENCE", "a b"],
    ["ROUTER_EXECUTION_CONFIG", "/config/config.json\n"],
    ["ROUTER_OPERATIONS_DIR", "../persisted"],
  ])("[GR-1] refuses %s set to %j", (name, value) => {
    expect(findUnsafeRouterEnvironment({ ...environment(), [name]: value })).toEqual([name]);
  });

  it("[GR-1] refuses an environment missing a variable the config uses", () => {
    const missing = Object.fromEntries(
      Object.entries(environment()).filter(([name]) => name !== "ROUTER_JWKS_URL"),
    );

    expect(findUnsafeRouterEnvironment(missing)).toEqual(["ROUTER_JWKS_URL"]);
  });
});
