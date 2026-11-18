import { describe, expect, it } from "vitest";
import {
  findBannedRouterSettings,
  findBannedSandboxSettings,
  findUnknownRouterVariables,
  findUnknownSandboxVariables,
  findUnsafeRouterEnvironment,
  findUnsafeSandboxEnvironment,
} from "../src/index.ts";

/** The limits both routers hold to, as router/config.yaml sets them. */
const limits = () => ({
  mode: "enforce",
  depth: { enabled: true, limit: 3 },
  total_fields: { enabled: true, limit: 60 },
  root_fields: { enabled: true, limit: 3 },
  root_field_aliases: { enabled: true, limit: 0 },
});

/** A config that passes: router/config.yaml as parsed, with a real origin. */
const safe = (): Record<string, unknown> => ({
  version: "1",
  listen_addr: "${ROUTER_LISTEN_ADDR}",
  json_log: true,
  log_level: "info",
  dev_mode: false,
  demo_mode: false,
  introspection: { enabled: false },
  playground: { enabled: false },
  introspection_enabled: false,
  playground_enabled: false,
  query_plans_enabled: false,
  engine: { debug: { always_include_query_plan: false } },
  mcp: { enabled: false },
  connect_rpc: { enabled: false },
  cors: { allow_origins: ["https://traverse.example"], match_origins: [] },
  execution_config: { file: { path: "${ROUTER_EXECUTION_CONFIG}" } },
  storage_providers: { file_system: [{ id: "operations", path: "${ROUTER_OPERATIONS_DIR}" }] },
  persisted_operations: {
    disabled: false,
    storage: { provider_id: "operations", object_prefix: "operations" },
  },
  automatic_persisted_queries: { enabled: false },
  security: {
    block_non_persisted_operations: { enabled: true, condition: "true" },
    complexity_limits: limits(),
  },
  access_logs: {
    router: { ignore_query_params_list: ["query", "variables", "extensions", "operationName"] },
  },
  traffic_shaping: { router: { max_request_body_size: "1MB" } },
  authentication: {
    jwt: {
      on_error: "reject",
      jwks: [{ url: "${ROUTER_JWKS_URL}", audiences: ["${ROUTER_JWT_AUDIENCE}"] }],
    },
  },
  authorization: { require_authentication: false },
  headers: { all: { request: [{ op: "propagate", named: "Authorization" }] } },
});

/** Every rule's setting, in the order the check reports them. */
const SETTINGS = [
  "version",
  "listen_addr",
  "execution_config.file.path",
  "json_log",
  "log_level",
  "access_logs.router.ignore_query_params_list",
  "traffic_shaping.router.max_request_body_size",
  "dev_mode",
  "demo_mode",
  "introspection.enabled",
  "introspection_enabled",
  "playground.enabled",
  "playground_enabled",
  "mcp.enabled",
  "connect_rpc.enabled",
  "automatic_persisted_queries.enabled",
  "security.complexity_limits.mode",
  "security.complexity_limits.depth.enabled",
  "security.complexity_limits.depth.limit",
  "security.complexity_limits.total_fields.enabled",
  "security.complexity_limits.total_fields.limit",
  "security.complexity_limits.root_fields.enabled",
  "security.complexity_limits.root_fields.limit",
  "security.complexity_limits.root_field_aliases.enabled",
  "security.complexity_limits.root_field_aliases.limit",
  "query_plans_enabled",
  "engine.debug.always_include_query_plan",
  "cors.allow_origins",
  "cors.match_origins",
  "security.block_non_persisted_operations.enabled",
  "security.block_non_persisted_operations.condition",
  "persisted_operations.disabled",
  "storage_providers.file_system",
  "persisted_operations.storage.provider_id",
  "persisted_operations.storage.object_prefix",
  "authentication.jwt.on_error",
  "authentication.jwt.jwks",
  "authorization.require_authentication",
  "headers.all.request",
];

/** Settings neither router has a rule for. Each could undo a guardrail without naming a banned key. */
const UNRULED: [string, string, unknown][] = [
  [
    "a routing override, which could point a subgraph anywhere",
    "override_routing_url.subgraphs.packages",
    "http://169.254.169.254",
  ],
  ["a second listener", "telemetry.metrics.prometheus.listen_addr", "0.0.0.0:8088"],
  ["variables exported in traces", "telemetry.tracing.export_graphql_variables", true],
  ["plugins", "plugins.enabled", true],
  ["a graph token", "graph.token", "token"],
  ["printed query plans", "engine.debug.print_query_plans", true],
  ["a section left empty", "events", {}],
];

/** Adds a setting, and any section it needs, to a copy of a config. */
const withNewSetting = (setting: string, value: unknown, base: Record<string, unknown>) => {
  const config = structuredClone(base);
  const keys = setting.split(".");
  const last = keys.pop() as string;
  const parent = keys.reduce<Record<string, unknown>>(
    (node, key) => (node[key] ??= {}) as Record<string, unknown>,
    config,
  );
  parent[last] = value;
  return config;
};

/** Sets one dotted setting in a copy of the safe config, or removes it when value is undefined. */
const withSetting = (setting: string, value: unknown, base = safe()) => {
  const config = structuredClone(base);
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
    ["another config version", "version", "2"],
    ["a literal address, which could be every interface", "listen_addr", "0.0.0.0:3002"],
    ["a literal execution config", "execution_config.file.path", "/tmp/other.json"],
    ["plain-text logs", "json_log", false],
    ["debug logs", "log_level", "debug"],
    [
      "an access log that keeps a GET's operation",
      "access_logs.router.ignore_query_params_list",
      ["variables"],
    ],
    ["a larger request body", "traffic_shaping.router.max_request_body_size", "5MB"],
    [
      "an access log list with more in it than the four names",
      "access_logs.router.ignore_query_params_list",
      ["query", "variables", "extensions", "operationName", { a: 1 }],
    ],
    ["limits that only measure", "security.complexity_limits.mode", "measure"],
    ["no depth limit", "security.complexity_limits.depth.enabled", false],
    ["no field limit", "security.complexity_limits.total_fields.enabled", false],
    ["no root field limit", "security.complexity_limits.root_fields.enabled", false],
    ["a root field limit nobody would reach", "security.complexity_limits.root_fields.limit", 50],
    ["no alias limit", "security.complexity_limits.root_field_aliases.enabled", false],
    ["an alias limit below zero", "security.complexity_limits.root_field_aliases.limit", -1],
    ["a depth limit nobody would reach", "security.complexity_limits.depth.limit", 1000],
    ["a field limit nobody would reach", "security.complexity_limits.total_fields.limit", 100000],
    [
      "operations from a second folder",
      "storage_providers.file_system",
      [
        { id: "operations", path: "${ROUTER_OPERATIONS_DIR}" },
        { id: "extra", path: "/tmp" },
      ],
    ],
    ["operations from another provider", "persisted_operations.storage.provider_id", "s3"],
    ["operations under another prefix", "persisted_operations.storage.object_prefix", "../"],
    [
      "a second key source",
      "authentication.jwt.jwks",
      [
        { url: "${ROUTER_JWKS_URL}", audiences: ["${ROUTER_JWT_AUDIENCE}"] },
        { url: "https://attacker.example/jwks.json" },
      ],
    ],
    ["keys with no audience check", "authentication.jwt.jwks", [{ url: "${ROUTER_JWKS_URL}" }]],
    ["sign-in required for public data", "authorization.require_authentication", true],
    [
      "every header forwarded to subgraphs",
      "headers.all.request",
      [{ op: "propagate", matching: ".*" }],
    ],
  ])("[GR-1] refuses %s", (_, setting, value) => {
    expect(findBannedRouterSettings(withSetting(setting, value))).toEqual([setting]);
  });

  // The router reads its environment first and lays the file on top, so a key the file leaves
  // out still takes its environment variable: APQ_ENABLED, MCP_ENABLED, CORS_MATCH_ORIGINS...
  it.each(SETTINGS)("[GR-1] refuses a config that leaves %s to the environment", (setting) => {
    // The section it sat in may now be empty, which is reported too.
    expect(findBannedRouterSettings(withSetting(setting, undefined))).toContain(setting);
  });

  it("[GR-1] refuses a variable where a literal belongs", () => {
    expect(findBannedRouterSettings(withSetting("dev_mode", "${DEV_MODE}"))).toEqual(["dev_mode"]);
  });

  it("[GR-1] accepts the one origin variable, which the environment check holds to a format", () => {
    const config = withSetting("cors.allow_origins", ["${ROUTER_CORS_ORIGIN}"]);

    expect(findBannedRouterSettings(config)).toEqual([]);
  });

  it.each(UNRULED)(
    "[GR-1] refuses %s, because the public router has no rule for it",
    (_, setting, value) => {
      expect(findBannedRouterSettings(withNewSetting(setting, value, safe()))).toEqual([setting]);
    },
  );

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

/** The smallest sandbox config that passes. Query plans and free-form reads aren't its concern. */
const safeSandbox = (): Record<string, unknown> => ({
  version: "1",
  listen_addr: "${ROUTER_LISTEN_ADDR}",
  execution_config: { file: { path: "${ROUTER_EXECUTION_CONFIG}" } },
  json_log: true,
  log_level: "info",
  query_plans_enabled: true,
  engine: { debug: { always_include_query_plan: true } },
  access_logs: {
    router: { ignore_query_params_list: ["query", "variables", "extensions", "operationName"] },
  },
  traffic_shaping: { router: { max_request_body_size: "1MB" } },
  dev_mode: false,
  demo_mode: false,
  introspection: { enabled: false },
  introspection_enabled: false,
  playground: { enabled: false },
  playground_enabled: false,
  mcp: { enabled: false },
  connect_rpc: { enabled: false },
  automatic_persisted_queries: { enabled: false },
  security: {
    block_mutations: { enabled: true, condition: "true" },
    block_subscriptions: { enabled: true, condition: "true" },
    block_non_persisted_operations: { enabled: false },
    complexity_limits: limits(),
  },
  websocket: { enabled: false },
  batching: { enabled: false },
  file_upload: { enabled: false },
  cors: { enabled: false, allow_origins: [], match_origins: [], allow_credentials: false },
});

const UNSAFE_SANDBOX: [string, string, unknown][] = [
  ["dev mode", "dev_mode", true],
  ["demo mode", "demo_mode", true],
  ["introspection", "introspection.enabled", true],
  ["the deprecated introspection key", "introspection_enabled", true],
  ["the playground", "playground.enabled", true],
  ["the deprecated playground key", "playground_enabled", true],
  ["the MCP server", "mcp.enabled", true],
  ["the ConnectRPC server", "connect_rpc.enabled", true],
  ["operations registered by clients", "automatic_persisted_queries.enabled", true],
  ["mutations", "security.block_mutations.enabled", false],
  ["a condition that could let a mutation through", "security.block_mutations.condition", "false"],
  ["subscriptions", "security.block_subscriptions.enabled", false],
  [
    "a condition that could let a subscription through",
    "security.block_subscriptions.condition",
    "request.header.Get('x') == 'y'",
  ],
  ["limits that only measure", "security.complexity_limits.mode", "measure"],
  ["no depth limit", "security.complexity_limits.depth.enabled", false],
  ["no field limit", "security.complexity_limits.total_fields.enabled", false],
  ["no root field limit", "security.complexity_limits.root_fields.enabled", false],
  ["no alias limit", "security.complexity_limits.root_field_aliases.enabled", false],
  ["a depth limit of nothing", "security.complexity_limits.depth.limit", 0],
  ["a depth limit nobody would reach", "security.complexity_limits.depth.limit", 1000],
  ["a field limit that isn't a whole number", "security.complexity_limits.total_fields.limit", 1.5],
  ["a field limit nobody would reach", "security.complexity_limits.total_fields.limit", 100000],
  ["a root field limit written as text", "security.complexity_limits.root_fields.limit", "3"],
  ["an alias limit below zero", "security.complexity_limits.root_field_aliases.limit", -1],
  ["an alias limit nobody would reach", "security.complexity_limits.root_field_aliases.limit", 500],
  ["WebSockets", "websocket.enabled", true],
  ["batches", "batching.enabled", true],
  ["uploads", "file_upload.enabled", true],
  ["CORS", "cors.enabled", true],
  ["an origin", "cors.allow_origins", ["https://traverse.example"]],
  ["an origin pattern", "cors.match_origins", [".*"]],
  ["credentials", "cors.allow_credentials", true],
  ["another config version", "version", "2"],
  ["a literal address, which could be every interface", "listen_addr", "0.0.0.0:3002"],
  ["a literal execution config", "execution_config.file.path", "/tmp/other.json"],
  ["plain-text logs", "json_log", false],
  ["debug logs", "log_level", "debug"],
  ["a query plan setting that isn't a boolean", "query_plans_enabled", "${PLANS}"],
  ["a plan setting that isn't a boolean", "engine.debug.always_include_query_plan", "yes"],
  [
    "a persisted-only setting that isn't a boolean",
    "security.block_non_persisted_operations.enabled",
    "${BLOCK}",
  ],
  [
    "an access log that keeps a GET's operation",
    "access_logs.router.ignore_query_params_list",
    ["variables"],
  ],
  ["an access log setting that isn't a list", "access_logs.router.ignore_query_params_list", "*"],
  ["a larger request body", "traffic_shaping.router.max_request_body_size", "5MB"],
];

describe("findBannedSandboxSettings", () => {
  it("[GR-11] accepts a config that sets every setting safely, with query plans on", () => {
    expect(findBannedSandboxSettings(safeSandbox())).toEqual([]);
  });

  it.each([
    ...UNRULED,
    ["forwarded headers", "headers.all.request", [{ op: "propagate", matching: ".*" }]],
  ])("[GR-11] refuses %s, because the sandbox has no rule for it", (_, setting, value) => {
    expect(findBannedSandboxSettings(withNewSetting(setting, value, safeSandbox()))).toEqual([
      setting,
    ]);
  });

  it.each(UNSAFE_SANDBOX)("[GR-11] refuses %s", (_, setting, value) => {
    expect(findBannedSandboxSettings(withSetting(setting, value, safeSandbox()))).toEqual([
      setting,
    ]);
  });

  it.each([...new Set(UNSAFE_SANDBOX.map(([, setting]) => setting))])(
    "[GR-11] refuses a config that leaves %s to the environment",
    (setting) => {
      const config = withSetting(setting, undefined, safeSandbox());

      // The section it sat in may now be empty, which is reported too.
      expect(findBannedSandboxSettings(config)).toContain(setting);
    },
  );

  it("[GR-11] refuses the public router's config, which blocks no mutation", () => {
    expect(findBannedSandboxSettings(safe())).toContain("security.block_mutations.enabled");
  });

  it("[GR-11] refuses something that isn't a config", () => {
    expect(findBannedSandboxSettings("dev_mode: false")).toEqual(["(the config itself)"]);
  });
});

describe("the sandbox router's variables and environment", () => {
  const sandboxEnvironment = {
    CONFIG_PATH: "/config/sandbox.yaml",
    ROUTER_LISTEN_ADDR: "127.0.0.1:3004",
    ROUTER_EXECUTION_CONFIG: "/config/config.json",
  };

  it("[GR-1] keeps each router to its own file, though both sit in one folder", () => {
    expect(
      findUnsafeRouterEnvironment({ ...environment(), CONFIG_PATH: "/config/sandbox.yaml" }),
    ).toEqual(["CONFIG_PATH"]);
    expect(
      findUnsafeSandboxEnvironment({ ...sandboxEnvironment, CONFIG_PATH: "/config/config.yaml" }),
    ).toEqual(["CONFIG_PATH"]);
  });

  it("[GR-11] isn't fooled by a name every object has", () => {
    expect(findUnknownSandboxVariables("a: ${constructor}\nb: ${toString}")).toEqual([
      "constructor",
      "toString",
    ]);
    expect(findUnsafeSandboxEnvironment({ ...sandboxEnvironment, toString: "x" })).toEqual([
      "toString",
    ]);
  });

  it("[GR-11] knows three variables, and names any other", () => {
    const text =
      "a: ${ROUTER_LISTEN_ADDR}\nb: ${ROUTER_EXECUTION_CONFIG}\nc: ${ROUTER_CORS_ORIGIN}";

    expect(findUnknownSandboxVariables(text)).toEqual(["ROUTER_CORS_ORIGIN"]);
  });

  it("[GR-11] accepts an environment of exactly those three, well formed", () => {
    expect(findUnsafeSandboxEnvironment(sandboxEnvironment)).toEqual([]);
  });

  it.each([
    ["SECURITY_BLOCK_MUTATIONS_ENABLED", "false"],
    ["SECURITY_BLOCK_MUTATIONS_CONDITION", "false"],
    ["SECURITY_BLOCK_SUBSCRIPTIONS_ENABLED", "false"],
    ["DEV_MODE", "true"],
    ["WEBSOCKETS_ENABLED", "true"],
    ["CORS_ALLOW_ORIGINS", "*"],
    ["ROUTER_CORS_ORIGIN", "https://traverse.example"],
  ])("[GR-11] refuses %s in the environment, which the router would read", (name, value) => {
    expect(findUnsafeSandboxEnvironment({ ...sandboxEnvironment, [name]: value })).toEqual([name]);
  });

  it.each([
    ["CONFIG_PATH", "/config/sandbox.yaml,/tmp/override.yaml"],
    ["ROUTER_LISTEN_ADDR", "127.0.0.1:3004\ndev_mode: true"],
    ["ROUTER_EXECUTION_CONFIG", "config.json"],
  ])("[GR-11] refuses %s set to %j", (name, value) => {
    expect(findUnsafeSandboxEnvironment({ ...sandboxEnvironment, [name]: value })).toEqual([name]);
  });
});
