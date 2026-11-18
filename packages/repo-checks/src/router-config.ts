import { isDeepStrictEqual } from "node:util";

/**
 * GR-1 and GR-2 for the public router. The router reads its environment first and lays the config
 * file on top, so a key the file leaves out still takes its environment variable (C-50), and the
 * defaults for introspection, the playground, query plans and CORS are unsafe (C-9). So the file
 * must set every one of these literally, and the deployment's environment must hold only the
 * variables the file uses, each in a strict format. The router expands `${VAR}` in the file's raw
 * text before parsing it (C-43), so a variable could otherwise carry new keys in.
 */
type Rule = [setting: string, isSafe: (value: unknown) => boolean];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const read = (config: Record<string, unknown>, setting: string): unknown =>
  setting
    .split(".")
    .reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), config);

const isFalse = (value: unknown) => value === false;
const isTrue = (value: unknown) => value === true;
const isAlways = (value: unknown) => value === "true";
const isEmptyList = (value: unknown) => Array.isArray(value) && value.length === 0;
const isBoolean = (value: unknown) => typeof value === "boolean";
const isExactly = (expected: unknown) => (value: unknown) => isDeepStrictEqual(value, expected);
const hidesOperations = isExactly(["query", "variables", "extensions", "operationName"]);
// A limit that's on but set to nothing, or to a number nobody would reach, limits nothing.
const isWithin = (min: number, max: number) => (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

const ORIGIN = /^(?:https:\/\/[a-z0-9.-]+|http:\/\/(?:127\.0\.0\.1|localhost))(?::\d{1,5})?$/;
const ORIGIN_VARIABLE = "${ROUTER_CORS_ORIGIN}";

/** What both routers must set the same way: where they listen and log, and what they never serve. */
const SHARED_RULES: Rule[] = [
  ["version", (value) => value === "1"],
  ["listen_addr", (value) => value === "${ROUTER_LISTEN_ADDR}"],
  ["execution_config.file.path", (value) => value === "${ROUTER_EXECUTION_CONFIG}"],
  ["json_log", isTrue],
  ["log_level", (value) => value === "info" || value === "warn" || value === "error"],
  // A GET carries the operation and its variables in the address, which the access log would
  // otherwise keep (C-55, GR-4).
  ["access_logs.router.ignore_query_params_list", hidesOperations],
  ["traffic_shaping.router.max_request_body_size", (value) => value === "1MB"],
  ["dev_mode", isFalse],
  ["demo_mode", isFalse],
  ["introspection.enabled", isFalse],
  ["introspection_enabled", isFalse],
  ["playground.enabled", isFalse],
  ["playground_enabled", isFalse],
  // MCP's get_schema returns the whole schema, even with introspection off (C-51).
  ["mcp.enabled", isFalse],
  ["connect_rpc.enabled", isFalse],
  ["automatic_persisted_queries.enabled", isFalse],
  ["security.complexity_limits.mode", (value) => value === "enforce"],
  ["security.complexity_limits.depth.enabled", isTrue],
  ["security.complexity_limits.depth.limit", isWithin(1, 10)],
  ["security.complexity_limits.total_fields.enabled", isTrue],
  ["security.complexity_limits.total_fields.limit", isWithin(1, 200)],
  ["security.complexity_limits.root_fields.enabled", isTrue],
  ["security.complexity_limits.root_fields.limit", isWithin(1, 10)],
  ["security.complexity_limits.root_field_aliases.enabled", isTrue],
  // Zero aliases is a real limit: the router refuses any (C-45).
  ["security.complexity_limits.root_field_aliases.limit", isWithin(0, 10)],
];

/**
 * GR-1 and GR-2 for the public router. It's an allow-list: a setting with no rule fails, because a
 * list of banned settings can't name every key the router has.
 */
const RULES: Rule[] = [
  ...SHARED_RULES,
  // Overrides engine.debug.always_include_query_plan (C-37), and both stay off.
  ["query_plans_enabled", isFalse],
  ["engine.debug.always_include_query_plan", isFalse],
  [
    "cors.allow_origins",
    (origins) =>
      Array.isArray(origins) &&
      origins.length > 0 &&
      origins.every(
        (origin) =>
          origin === ORIGIN_VARIABLE || (typeof origin === "string" && ORIGIN.test(origin)),
      ),
  ],
  ["cors.match_origins", isEmptyList],
  ["security.block_non_persisted_operations.enabled", isTrue],
  ["security.block_non_persisted_operations.condition", isAlways],
  ["persisted_operations.disabled", isFalse],
  // Operations load from the one folder the environment check holds to an absolute path.
  [
    "storage_providers.file_system",
    isExactly([{ id: "operations", path: "${ROUTER_OPERATIONS_DIR}" }]),
  ],
  ["persisted_operations.storage.provider_id", (value) => value === "operations"],
  ["persisted_operations.storage.object_prefix", (value) => value === "operations"],
  // A bad token is refused, never treated as anonymous, and anonymous reads stay open (ADR 0015).
  ["authentication.jwt.on_error", (value) => value === "reject"],
  [
    "authentication.jwt.jwks",
    isExactly([{ url: "${ROUTER_JWKS_URL}", audiences: ["${ROUTER_JWT_AUDIENCE}"] }]),
  ],
  ["authorization.require_authentication", isFalse],
  // Subgraphs verify the token again themselves (C-40), and no other header reaches them.
  ["headers.all.request", isExactly([{ op: "propagate", named: "Authorization" }])],
];

/**
 * GR-11 for the sandbox router, which only the web server calls. It may return query plans and
 * run free-form reads, but must block mutations and subscriptions, with their conditions set so
 * the environment can't supply one (C-53). No browser calls it, so it allows no origin at all.
 */
const SANDBOX_RULES: Rule[] = [
  ...SHARED_RULES,
  // What the sandbox is for. Either value is safe here, and only here.
  ["query_plans_enabled", isBoolean],
  ["engine.debug.always_include_query_plan", isBoolean],
  ["security.block_non_persisted_operations.enabled", isBoolean],
  ["cors.allow_credentials", isFalse],
  ["security.block_mutations.enabled", isTrue],
  ["security.block_mutations.condition", isAlways],
  ["security.block_subscriptions.enabled", isTrue],
  ["security.block_subscriptions.condition", isAlways],
  // Subscriptions arrive over WebSockets, a batch is many operations in one request, and an
  // upload only ever belongs to a mutation.
  ["websocket.enabled", isFalse],
  ["batching.enabled", isFalse],
  ["file_upload.enabled", isFalse],
  ["cors.enabled", isFalse],
  ["cors.allow_origins", isEmptyList],
  ["cors.match_origins", isEmptyList],
];

/** Every setting a config holds, as dotted paths. A list or an empty section counts as one. */
const settingsIn = (node: Record<string, unknown>, prefix = ""): string[] =>
  Object.entries(node).flatMap(([key, value]) =>
    isRecord(value) && Object.keys(value).length > 0
      ? settingsIn(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );

/**
 * Refuses each setting its rule rejects, and any setting with no rule, such as a second listener,
 * a routing override or a telemetry export.
 */
const findBanned =
  (rules: Rule[]) =>
  (config: unknown): string[] => {
    if (!isRecord(config)) return ["(the config itself)"];
    const known = new Set(rules.map(([setting]) => setting));
    const banned = rules
      .filter(([setting, isSafe]) => !isSafe(read(config, setting)))
      .map(([setting]) => setting);
    const unknown = settingsIn(config).filter((setting) => !known.has(setting));
    return [...banned, ...unknown];
  };

/** Lists each setting that breaks GR-1 or GR-2 or has no rule, or the whole config if it isn't one. */
export const findBannedRouterSettings = findBanned(RULES);

/** Lists each setting that breaks GR-11 or that the sandbox has no rule for, or the whole config if it isn't one. */
export const findBannedSandboxSettings = findBanned(SANDBOX_RULES);

const ABSOLUTE_PATH = /^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const LOCAL_URL = String.raw`http:\/\/127\.0\.0\.1:\d{1,5}`;

/** Every variable the public config may use, and the only shape each value may take. */
const VARIABLES: Record<string, RegExp> = {
  // Each router may load its own file and no other: the two sit in one folder, and the public
  // router started on the sandbox's file would serve plans and free-form operations.
  CONFIG_PATH: /^\/(?:[A-Za-z0-9._-]+\/)*config\.yaml$/,
  ROUTER_LISTEN_ADDR: /^[a-z0-9.-]+:\d{1,5}$/,
  ROUTER_CORS_ORIGIN: ORIGIN,
  ROUTER_EXECUTION_CONFIG: ABSOLUTE_PATH,
  ROUTER_OPERATIONS_DIR: ABSOLUTE_PATH,
  ROUTER_JWKS_URL: new RegExp(
    String.raw`^(?:https:\/\/[a-z0-9.-]+(?::\d{1,5})?|${LOCAL_URL})(?:\/[A-Za-z0-9._-]+)+$`,
  ),
  ROUTER_JWT_AUDIENCE: /^[A-Za-z0-9._:-]{1,128}$/,
};

/** The sandbox config uses three of them: it has no origin, no persisted operations and no tokens. */
const SANDBOX_VARIABLES: Record<string, RegExp> = {
  CONFIG_PATH: /^\/(?:[A-Za-z0-9._-]+\/)*sandbox\.yaml$/,
  ROUTER_LISTEN_ADDR: VARIABLES.ROUTER_LISTEN_ADDR as RegExp,
  ROUTER_EXECUTION_CONFIG: ABSOLUTE_PATH,
};

const findUnknownVariables =
  (variables: Record<string, RegExp>) =>
  (text: string): string[] =>
    [...text.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)]
      .map(([, name]) => name as string)
      .filter((name) => !Object.hasOwn(variables, name));

const findUnsafeEnvironment =
  (variables: Record<string, RegExp>) =>
  (env: Record<string, string>): string[] => {
    const unknown = Object.keys(env).filter((name) => !Object.hasOwn(variables, name));
    const unsafe = Object.entries(variables)
      .filter(([name, shape]) => {
        const value = env[name];
        return value === undefined || !shape.test(value);
      })
      .map(([name]) => name);
    return [...unknown, ...unsafe];
  };

/** Names each variable in the config's raw text that the environment check doesn't hold. */
export const findUnknownRouterVariables = findUnknownVariables(VARIABLES);
export const findUnknownSandboxVariables = findUnknownVariables(SANDBOX_VARIABLES);

/**
 * Checks a router's whole environment, as a deployment sets it. Anything else would reach a
 * setting the file leaves out, and a value out of shape could rewrite the file as it's expanded.
 */
export const findUnsafeRouterEnvironment = findUnsafeEnvironment(VARIABLES);
export const findUnsafeSandboxEnvironment = findUnsafeEnvironment(SANDBOX_VARIABLES);
