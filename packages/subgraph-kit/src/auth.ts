import { GraphQLError } from "graphql";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { JwtConfig } from "./config.ts";
import type { Logger } from "./logging.ts";

export type KeySource = JWTVerifyGetKey;

export type VerifyUser = (
  authorization: string | null,
  logger: Logger,
) => Promise<string | undefined>;

const BEARER = /^Bearer (.+)$/;

const verifyToken = async (
  token: string,
  keys: KeySource,
  { audience, issuer }: JwtConfig,
  logger: Logger,
): Promise<string | undefined> => {
  try {
    const { payload } = await jwtVerify(token, keys, {
      audience,
      issuer,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "sub"],
    });
    // An ID token from the same pool has the same issuer and signer, and carries the user's email
    // (A-11), so only an access token may stand for a user.
    if (payload.token_use !== "access") return undefined;
    // jose doesn't check the type of `sub`, and this value will scope queries on users' data.
    return typeof payload.sub === "string" && payload.sub !== "" ? payload.sub : undefined;
  } catch (error) {
    // Codes are fixed strings. A key outage has none, and would otherwise look like anonymous use.
    const reason = (error as { code?: string }).code ?? "keys-unavailable";
    logger.warn({ reason }, "token not verified");
    return undefined;
  }
};

export const noUser: VerifyUser = () => Promise.resolve(undefined);

/**
 * The router has already refused a bad token, but a subgraph never takes its word for who the user
 * is (GR-3). Anything that can't be verified here means no user, not an error, because public data
 * needs no token.
 */
export const createUserVerifier =
  (keys: KeySource | undefined, jwt: JwtConfig): VerifyUser =>
  (authorization, logger) => {
    const token = BEARER.exec(authorization ?? "")?.[1];
    if (token === undefined) return Promise.resolve(undefined);
    return verifyToken(token, keys ?? createRemoteJWKSet(new URL(jwt.url)), jwt, logger);
  };

/**
 * The verified user, or a refusal for anyone else. Every resolver over a user's own data starts
 * here, and scopes its query by what this returns, never by anything the caller sent (GR-3).
 */
export const requireUser = ({ userId }: { userId: string | undefined }): string => {
  if (userId === undefined) {
    throw new GraphQLError("Sign in first.", { extensions: { code: "UNAUTHENTICATED" } });
  }
  return userId;
};
