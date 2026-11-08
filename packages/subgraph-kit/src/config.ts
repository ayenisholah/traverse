import { z } from "zod";

const integer = (fallback: string) => z.string().regex(/^\d+$/).default(fallback).transform(Number);

const isTrustedKeyUrl = (url: string): boolean => {
  const { protocol, hostname } = new URL(url);
  const isLocalService = !hostname.includes(".") || hostname === "127.0.0.1";
  return protocol === "https:" || (protocol === "http:" && isLocalService);
};

// Plain redis:// sends the password and cached data unencrypted, so it's only for a local service.
const isTrustedRedisUrl = (url: string): boolean => {
  const { protocol, hostname } = new URL(url);
  const isLocalService = !hostname.includes(".") || hostname === "127.0.0.1";
  return protocol === "rediss:" || (protocol === "redis:" && isLocalService);
};

const environmentSchema = z
  .object({
    PORT: integer("4000").pipe(z.number().max(65_535)),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug"]).default("info"),
    SHUTDOWN_DRAIN_MS: integer("5000"),
    SHUTDOWN_CLOSE_MS: integer("10000"),
    JWKS_URL: z
      .url({ abort: true })
      .refine(isTrustedKeyUrl, "must use https, or http to a local service")
      .optional(),
    JWT_AUDIENCE: z.string().min(1).optional(),
    JWT_ISSUER: z.string().min(1).optional(),
    REDIS_URL: z
      .url({ abort: true })
      .refine(isTrustedRedisUrl, "must use rediss://, or redis:// to a local service")
      .optional(),
  })
  .refine(
    ({ JWKS_URL, JWT_AUDIENCE, JWT_ISSUER }) =>
      new Set([JWKS_URL, JWT_AUDIENCE, JWT_ISSUER].map((value) => value === undefined)).size === 1,
    { path: ["JWKS_URL"], message: "JWKS_URL, JWT_AUDIENCE and JWT_ISSUER go together" },
  );

export interface JwtConfig {
  url: string;
  audience: string;
  issuer: string;
}

export interface SubgraphConfig {
  port: number;
  logLevel: string;
  drainMs: number;
  closeMs: number;
  jwt: JwtConfig | undefined;
  redisUrl: string | undefined;
}

/** A subgraph can't run on a bad environment, so this throws at startup. */
export const parseConfig = (env: Record<string, string | undefined>): SubgraphConfig => {
  const parsed = environmentSchema.parse(env);
  const { JWKS_URL: url, JWT_AUDIENCE: audience, JWT_ISSUER: issuer } = parsed;
  return {
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    drainMs: parsed.SHUTDOWN_DRAIN_MS,
    closeMs: parsed.SHUTDOWN_CLOSE_MS,
    jwt: url && audience && issuer ? { url, audience, issuer } : undefined,
    redisUrl: parsed.REDIS_URL,
  };
};
