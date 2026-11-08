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

/** Lists each setting that breaks GR-1 or GR-2, or the whole config if it isn't one. */
export const findBannedRouterSettings = (config: unknown): string[] => {
  if (!isRecord(config)) return ["(the config itself)"];
  return RULES.filter(([setting, isSafe]) => !isSafe(read(config, setting))).map(
    ([setting]) => setting,
  );
};

const ABSOLUTE_PATH = /^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const LOCAL_URL = String.raw`http:\/\/127\.0\.0\.1:\d{1,5}`;

/** Every variable the config may use, and the only shape each value may take. */
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

/** Names each variable in the config's raw text that the environment check doesn't hold. */
export const findUnknownRouterVariables = (text: string): string[] =>
  [...text.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)]
    .map(([, name]) => name as string)
    .filter((name) => !(name in VARIABLES));

/**
 * Checks the router's whole environment, as a deployment sets it. Anything else would reach a
 * setting the file leaves out, and a value out of shape could rewrite the file as it's expanded.
 */
export const findUnsafeRouterEnvironment = (env: Record<string, string>): string[] => {
  const unknown = Object.keys(env).filter((name) => !(name in VARIABLES));
  const unsafe = Object.entries(VARIABLES)
    .filter(([name, shape]) => {
      const value = env[name];
      return value === undefined || !shape.test(value);
    })
    .map(([name]) => name);
  return [...unknown, ...unsafe];
};
