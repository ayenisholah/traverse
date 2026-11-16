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

const ORIGIN = /^(?:https:\/\/[a-z0-9.-]+|http:\/\/(?:127\.0\.0\.1|localhost))(?::\d{1,5})?$/;
const ORIGIN_VARIABLE = "${ROUTER_CORS_ORIGIN}";

const RULES: Rule[] = [
  ["dev_mode", isFalse],
  ["demo_mode", isFalse],
  ["introspection.enabled", isFalse],
  ["introspection_enabled", isFalse],
  ["playground.enabled", isFalse],
  ["playground_enabled", isFalse],
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
  ["cors.match_origins", (patterns) => Array.isArray(patterns) && patterns.length === 0],
  ["security.block_non_persisted_operations.enabled", (value) => value === true],
  ["security.block_non_persisted_operations.condition", (value) => value === "true"],
  ["persisted_operations.disabled", isFalse],
  ["automatic_persisted_queries.enabled", isFalse],
  // MCP's get_schema returns the whole schema, even with introspection off (C-51).
  ["mcp.enabled", isFalse],
  ["connect_rpc.enabled", isFalse],
  // A bad token is refused, never treated as anonymous (ADR 0015).
  ["authentication.jwt.on_error", (value) => value === "reject"],
];

const isTrue = (value: unknown) => value === true;
const isAlways = (value: unknown) => value === "true";
const isEmptyList = (value: unknown) => Array.isArray(value) && value.length === 0;
// A limit that's on but set to nothing, or to a number nobody would reach, limits nothing.
const isWithin = (min: number, max: number) => (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/**
 * GR-11 for the sandbox router, which only the web server calls. It may return query plans and
 * run free-form reads, so those two rules are gone. Everything else stays banned, and it must
 * block mutations and subscriptions, with their conditions set so the environment can't supply
 * one (C-53). No browser calls it, so it allows no origin at all.
 */
const SANDBOX_RULES: Rule[] = [
  ["dev_mode", isFalse],
  ["demo_mode", isFalse],
  ["introspection.enabled", isFalse],
  ["introspection_enabled", isFalse],
  ["playground.enabled", isFalse],
  ["playground_enabled", isFalse],
  ["mcp.enabled", isFalse],
  ["connect_rpc.enabled", isFalse],
  ["automatic_persisted_queries.enabled", isFalse],
  ["security.block_mutations.enabled", isTrue],
  ["security.block_mutations.condition", isAlways],
  ["security.block_subscriptions.enabled", isTrue],
  ["security.block_subscriptions.condition", isAlways],
  // A free-form operation must cost no more than the limits allow.
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
  // Subscriptions arrive over WebSockets, a batch is many operations in one request, and an
  // upload only ever belongs to a mutation.
  ["websocket.enabled", isFalse],
  ["batching.enabled", isFalse],
  ["file_upload.enabled", isFalse],
  ["cors.enabled", isFalse],
  ["cors.allow_origins", isEmptyList],
  ["cors.match_origins", isEmptyList],
];

const findBanned =
  (rules: Rule[]) =>
  (config: unknown): string[] => {
    if (!isRecord(config)) return ["(the config itself)"];
    return rules
      .filter(([setting, isSafe]) => !isSafe(read(config, setting)))
      .map(([setting]) => setting);
  };

/** Lists each setting that breaks GR-1 or GR-2, or the whole config if it isn't one. */
export const findBannedRouterSettings = findBanned(RULES);

/** Lists each setting that breaks GR-11, or the whole config if it isn't one. */
export const findBannedSandboxSettings = findBanned(SANDBOX_RULES);

const ABSOLUTE_PATH = /^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const LOCAL_URL = String.raw`http:\/\/127\.0\.0\.1:\d{1,5}`;

/** Every variable the public config may use, and the only shape each value may take. */
const VARIABLES: Record<string, RegExp> = {
  CONFIG_PATH: /^\/[A-Za-z0-9._/-]+\.yaml$/,
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
  CONFIG_PATH: VARIABLES.CONFIG_PATH as RegExp,
  ROUTER_LISTEN_ADDR: VARIABLES.ROUTER_LISTEN_ADDR as RegExp,
  ROUTER_EXECUTION_CONFIG: ABSOLUTE_PATH,
};

const findUnknownVariables =
  (variables: Record<string, RegExp>) =>
  (text: string): string[] =>
    [...text.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)]
      .map(([, name]) => name as string)
      .filter((name) => !(name in variables));

const findUnsafeEnvironment =
  (variables: Record<string, RegExp>) =>
  (env: Record<string, string>): string[] => {
    const unknown = Object.keys(env).filter((name) => !(name in variables));
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
