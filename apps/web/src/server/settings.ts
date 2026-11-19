import { z } from "zod";

// A service name on a private network has no dot. An IPv6 literal has none either, so it's refused
// rather than mistaken for one.
const isLocal = (hostname: string): boolean =>
  hostname === "127.0.0.1" || (!hostname.includes(".") && !hostname.startsWith("["));

// An origin only: no path, query or credentials, so nothing else can ride along in the setting.
// Plain HTTP is for this machine or a service name on a private network, never a public host.
const isRouterOrigin = (value: string): boolean => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const isOrigin = url.origin === value && url.username === "" && url.password === "";
  return (
    isOrigin && (url.protocol === "https:" || (url.protocol === "http:" && isLocal(url.hostname)))
  );
};

// The user pool and this app carry the client secret, codes and tokens, so plain HTTP is for this
// machine alone, never a service name: a tested local run, nothing deployed.
const isAuthOrigin = (value: string): boolean => {
  if (!isRouterOrigin(value)) return false;
  const { protocol, hostname } = new URL(value);
  return protocol === "https:" || hostname === "127.0.0.1" || hostname === "localhost";
};

const schema = z.object({
  PUBLIC_ROUTER_URL: z.string().refine(isRouterOrigin),
  SANDBOX_ROUTER_URL: z.string().refine(isRouterOrigin),
});

// Cognito holds a resource to a URL (A-12), and the router's environment check to this shape.
const RESOURCE = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._-]+)*$/;
const SESSION_KEY_BYTES = 32;

const authSchema = z.object({
  APP_ORIGIN: z.string().refine(isAuthOrigin),
  AUTH_DOMAIN_URL: z.string().refine(isAuthOrigin),
  AUTH_CLIENT_ID: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  AUTH_CLIENT_SECRET: z.string().regex(/^[A-Za-z0-9+/=_-]{1,512}$/),
  AUTH_RESOURCE: z.string().regex(RESOURCE),
  SESSION_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine((key) => Buffer.from(key, "base64url").length === SESSION_KEY_BYTES),
});

const AUTH_NAMES = Object.keys(authSchema.shape);

export interface AuthSettings {
  /** This app's own origin, where the user pool sends the browser back and signs it out to. */
  appOrigin: string;
  /** The user pool's domain, which serves the OAuth 2.0 endpoints (A-13, A-14). */
  domainUrl: string;
  clientId: string;
  clientSecret: string;
  /** What each access token is bound to, and the router checks as its audience (A-12). */
  resource: string;
  /** Encrypts the session cookies. Changing it signs everyone out. */
  sessionKey: Uint8Array;
}

// Bedrock model and inference profile IDs, such as `eu.anthropic.<model>-v1:0` (U-19 picks one).
const MODEL_ID = /^[a-z0-9][a-z0-9.:-]{2,199}$/;
const REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;
// Plain redis:// carries the counts unencrypted, so it's only for this machine or a private name.
const isTrustedRedisUrl = (value: string): boolean => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "rediss:" || (url.protocol === "redis:" && isLocal(url.hostname));
};
// Only the local stand-in replaces Bedrock's own address (ADR 0022).
const isLocalEndpoint = (value: string): boolean =>
  /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(value) && isRouterOrigin(value);

const aiSchema = z.object({
  AI_MODEL_ID: z.string().regex(MODEL_ID),
  AI_REGION: z.string().regex(REGION),
  REDIS_URL: z.string().refine(isTrustedRedisUrl),
  AI_ENDPOINT: z.string().refine(isLocalEndpoint).optional(),
});

const AI_NAMES = ["AI_MODEL_ID", "AI_REGION", "REDIS_URL", "AI_ENDPOINT"];

export interface AiSettings {
  modelId: string;
  region: string;
  /** Where calls are counted against each user's limit (GR-15). */
  redisUrl: string;
  /** The local stand-in's address. Unset, the SDK reaches Bedrock itself. */
  endpoint: string | undefined;
}

export interface Settings {
  publicRouterUrl: string;
  /** The sandbox router, which only this server may reach (GR-11). */
  sandboxRouterUrl: string;
  /** Sign-in, when the server has a user pool. Without one, nobody can sign in. */
  auth: AuthSettings | undefined;
  /** The assistant, when it has a model and a counter. Without them it's off, and says so. */
  ai: AiSettings | undefined;
}

const readAi = (
  env: Record<string, string | undefined>,
  auth: AuthSettings | undefined,
): AiSettings | undefined => {
  if (AI_NAMES.every((name) => env[name] === undefined)) return undefined;
  const parsed = aiSchema.safeParse(env);
  // Only signed-in users may ask, so the limit counts a verified user (GR-15).
  if (!parsed.success || auth === undefined) {
    throw new Error(
      "Set AI_MODEL_ID, AI_REGION and REDIS_URL together, with sign-in set up, or none of them",
    );
  }
  return {
    modelId: parsed.data.AI_MODEL_ID,
    region: parsed.data.AI_REGION,
    redisUrl: parsed.data.REDIS_URL,
    endpoint: parsed.data.AI_ENDPOINT,
  };
};

const readAuth = (env: Record<string, string | undefined>): AuthSettings | undefined => {
  if (AUTH_NAMES.every((name) => env[name] === undefined)) return undefined;
  const parsed = authSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Set ${AUTH_NAMES.join(", ")} together, or none of them. SESSION_KEY is 32 random bytes in base64url`,
    );
  }
  const data = parsed.data;
  return {
    appOrigin: data.APP_ORIGIN,
    domainUrl: data.AUTH_DOMAIN_URL,
    clientId: data.AUTH_CLIENT_ID,
    clientSecret: data.AUTH_CLIENT_SECRET,
    resource: data.AUTH_RESOURCE,
    sessionKey: new Uint8Array(Buffer.from(data.SESSION_KEY, "base64url")),
  };
};

/**
 * The server's settings, read once. None of them may be a variable Next.js copies into the
 * browser's code (GR-9), and a test refuses that prefix anywhere in the app. The error never
 * repeats a value.
 */
export const readSettings = (env: Record<string, string | undefined>): Settings => {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      "Set PUBLIC_ROUTER_URL and SANDBOX_ROUTER_URL to each router's origin, such as http://127.0.0.1:3002",
    );
  }
  const auth = readAuth(env);
  return {
    publicRouterUrl: parsed.data.PUBLIC_ROUTER_URL,
    sandboxRouterUrl: parsed.data.SANDBOX_ROUTER_URL,
    auth,
    ai: readAi(env, auth),
  };
};
