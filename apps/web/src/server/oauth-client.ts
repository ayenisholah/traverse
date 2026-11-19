import { z } from "zod";
import type { AuthSettings } from "./settings.ts";

const TIMEOUT_MS = 10_000;
// A token answer is a few kilobytes. Anything far larger isn't one.
const MAX_ANSWER_LENGTH = 32_000;

const tokenText = z.string().min(1).max(8_000);
const grantSchema = z.object({
  access_token: tokenText,
  refresh_token: tokenText,
  expires_in: z.number().int().positive(),
});
const refreshSchema = z.object({
  access_token: tokenText,
  expires_in: z.number().int().positive(),
});

interface Grant {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** `refused` means the user pool said no, which ends the session; `unavailable`, it didn't answer. */
type Refreshed =
  | { kind: "refreshed"; accessToken: string; expiresIn: number }
  | { kind: "refused" }
  | { kind: "unavailable" };

export interface OAuthClient {
  /** Where to send the browser to sign in. */
  authorizeUrl: (state: string, codeChallenge: string) => string;
  redeem: (code: string, codeVerifier: string) => Promise<Grant | undefined>;
  refresh: (refreshToken: string) => Promise<Refreshed>;
  /** Whether the user pool took the revocation. */
  revoke: (refreshToken: string) => Promise<boolean>;
  /** Where to send the browser to end the user pool's own session. */
  logoutUrl: () => string;
}

const callbackPath = "/auth/callback";

type Post = (path: string, form: Record<string, string>) => Promise<Response | undefined>;

const createPost =
  (auth: AuthSettings, fetch: typeof globalThis.fetch): Post =>
  async (path, form) => {
    const basic = Buffer.from(`${auth.clientId}:${auth.clientSecret}`).toString("base64");
    try {
      return await fetch(`${auth.domainUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(form),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return undefined;
    }
  };

type GrantAnswer<T> = { kind: "granted"; grant: T } | { kind: "refused" } | { kind: "unavailable" };

const askForGrant = async <T>(
  post: Post,
  form: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<GrantAnswer<T>> => {
  const response = await post("/oauth2/token", form);
  // The token endpoint says no with 400, as for a revoked refresh token (A-13).
  if (response?.status === 400) return { kind: "refused" };
  if (response?.ok !== true) return { kind: "unavailable" };
  try {
    const text = await response.text();
    if (text.length > MAX_ANSWER_LENGTH) return { kind: "unavailable" };
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? { kind: "granted", grant: parsed.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
};

/**
 * Talks to the user pool's OAuth 2.0 endpoints as a confidential client (A-13, A-14). It asks for
 * no scope, so no `openid` and no ID token, and every grant binds the access token to `resource`,
 * which becomes its `aud` (A-12). Nothing the user pool says is passed on: an answer either parses
 * as a grant or counts as none.
 */
export const createOAuthClient = (
  auth: AuthSettings,
  fetch: typeof globalThis.fetch,
): OAuthClient => {
  const redirectUri = `${auth.appOrigin}${callbackPath}`;
  const post = createPost(auth, fetch);
  const grant = <T>(form: Record<string, string>, schema: z.ZodType<T>) =>
    askForGrant(post, form, schema);

  return {
    authorizeUrl: (state, codeChallenge) =>
      `${auth.domainUrl}/oauth2/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: auth.clientId,
        redirect_uri: redirectUri,
        state,
        code_challenge_method: "S256",
        code_challenge: codeChallenge,
        resource: auth.resource,
      }).toString()}`,
    redeem: async (code, codeVerifier) => {
      const answer = await grant(
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        },
        grantSchema,
      );
      if (answer.kind !== "granted") return undefined;
      return {
        accessToken: answer.grant.access_token,
        refreshToken: answer.grant.refresh_token,
        expiresIn: answer.grant.expires_in,
      };
    },
    refresh: async (refreshToken) => {
      const answer = await grant(
        { grant_type: "refresh_token", refresh_token: refreshToken },
        refreshSchema,
      );
      if (answer.kind !== "granted") return answer;
      // A rotated refresh token would be dropped here, so the app client keeps rotation off.
      return {
        kind: "refreshed",
        accessToken: answer.grant.access_token,
        expiresIn: answer.grant.expires_in,
      };
    },
    revoke: async (refreshToken) => {
      const response = await post("/oauth2/revoke", { token: refreshToken });
      return response?.ok === true;
    },
    logoutUrl: () =>
      `${auth.domainUrl}/logout?${new URLSearchParams({
        client_id: auth.clientId,
        logout_uri: `${auth.appOrigin}/`,
      }).toString()}`,
  };
};
