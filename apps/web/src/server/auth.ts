import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SealedCookies } from "./cookies.ts";
import type { OAuthClient } from "./oauth-client.ts";

const FLOW = "traverse-flow";
const ACCESS = "traverse-access";
const REFRESH = "traverse-session";

// Long enough to sign in, short enough that an abandoned attempt soon stops counting.
const FLOW_SECONDS = 10 * 60;
// However often the access token is refreshed, a session ends after this, and the user signs in
// again (FR-WB-10).
const SESSION_SECONDS = 12 * 60 * 60;
// The access token is dropped this long before it expires, so the router never sees it lapse
// part way through a request.
const EXPIRY_MARGIN_SECONDS = 60;

const flowSchema = z.object({ state: z.string(), verifier: z.string(), returnTo: z.string() });
const tokenSchema = z.object({ token: z.string() });
// When the session ends, in seconds since the epoch, however often it has been refreshed.
const sessionSchema = z.object({ token: z.string(), until: z.number() });

// Only a path on this app, so a link to /sign-in can't send someone elsewhere afterwards.
const RETURN_TO = /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/;
const failedPath = "/auth/failed";

interface Session {
  /** The user's access token for the public router, or none if nobody is signed in. */
  accessToken: string | undefined;
  /** Cookies to set on the answer, when the session changed while it was read. */
  setCookies: string[];
}

export interface Auth {
  signIn: (request: Request) => Promise<Response>;
  callback: (request: Request) => Promise<Response>;
  signOut: (request: Request) => Promise<Response>;
  session: (request: Request) => Promise<Session>;
}

interface Options {
  appOrigin: string;
  client: OAuthClient;
  cookies: SealedCookies;
  random?: () => string;
  /** Milliseconds since the epoch. */
  now?: () => number;
}

const randomValue = () => randomBytes(32).toString("base64url");

// Digests are always the same length, so any two values compare in constant time without
// throwing, whatever characters a forged one holds.
const digest = (value: string) => createHash("sha256").update(value).digest();
const sameText = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

const redirect = (location: string, setCookies: string[] = []) => {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
};

// An access cookie never outlives its token, nor the session it belongs to.
const accessSeconds = (expiresIn: number, sessionLeft: number) =>
  Math.max(1, Math.min(expiresIn - EXPIRY_MARGIN_SECONDS, sessionLeft));

const noSession = (setCookies: string[] = []): Session => ({ accessToken: undefined, setCookies });

/** The access token, refreshed if it has gone, while the session's 12 hours last. */
const readSession = async (
  request: Request,
  {
    client,
    cookies,
    seconds,
  }: { client: OAuthClient; cookies: SealedCookies; seconds: () => number },
): Promise<Session> => {
  const access = await cookies.open(request, ACCESS, tokenSchema);
  if (access !== undefined) return { accessToken: access.token, setCookies: [] };
  const refresh = await cookies.open(request, REFRESH, sessionSchema);
  if (refresh === undefined) return noSession();
  const ended = [cookies.clear(ACCESS), cookies.clear(REFRESH)];
  const sessionLeft = refresh.until - seconds();
  if (sessionLeft <= 0) return noSession(ended);
  const refreshed = await client.refresh(refresh.token);
  // A refused token has been revoked or has expired, so the session is over. A user pool that
  // didn't answer may answer next time, so the session waits for it.
  if (refreshed.kind === "refused") return noSession(ended);
  if (refreshed.kind === "unavailable") return noSession();
  const sealed = await cookies.seal(
    ACCESS,
    { token: refreshed.accessToken },
    accessSeconds(refreshed.expiresIn, sessionLeft),
  );
  return { accessToken: refreshed.accessToken, setCookies: [sealed] };
};

/**
 * Sign-in for the server build (ADR 0020). The browser only ever holds sealed cookies: the flow's
 * state and PKCE verifier while it signs in, then the access and refresh tokens. None of the
 * user pool's messages reach the browser, and a failure at any step sends it to one fixed page.
 */
export const createAuth = ({
  appOrigin,
  client,
  cookies,
  random = randomValue,
  now = Date.now,
}: Options): Auth => {
  const clearSession = () => [cookies.clear(ACCESS), cookies.clear(REFRESH)];
  const seconds = () => Math.floor(now() / 1000);

  return {
    signIn: async (request) => {
      const asked = new URL(request.url).searchParams.get("returnTo") ?? "/";
      const returnTo = RETURN_TO.test(asked) ? asked : "/";
      const state = random();
      const verifier = random();
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const flow = await cookies.seal(FLOW, { state, verifier, returnTo }, FLOW_SECONDS);
      return redirect(client.authorizeUrl(state, challenge), [flow]);
    },

    callback: async (request) => {
      const query = new URL(request.url).searchParams;
      const flow = await cookies.open(request, FLOW, flowSchema);
      const failed = () => redirect(`${appOrigin}${failedPath}`, [cookies.clear(FLOW)]);
      const code = query.get("code");
      if (flow === undefined || code === null || !sameText(query.get("state") ?? "", flow.state)) {
        return failed();
      }
      const grant = await client.redeem(code, flow.verifier);
      if (grant === undefined) return failed();
      const until = seconds() + SESSION_SECONDS;
      return redirect(`${appOrigin}${flow.returnTo}`, [
        cookies.clear(FLOW),
        await cookies.seal(
          ACCESS,
          { token: grant.accessToken },
          accessSeconds(grant.expiresIn, SESSION_SECONDS),
        ),
        await cookies.seal(REFRESH, { token: grant.refreshToken, until }, SESSION_SECONDS),
      ]);
    },

    signOut: async (request) => {
      // A form on another site can post here too, and SameSite=Lax wouldn't stop a top-level
      // POST from carrying the cookies, so only this app's own pages may sign someone out.
      if (request.headers.get("origin") !== appOrigin) {
        return new Response(null, { status: 403, headers: { "cache-control": "no-store" } });
      }
      const refresh = await cookies.open(request, REFRESH, sessionSchema);
      // The cookies go whether or not the user pool answers. An access token already issued lasts
      // until it expires, because the routers verify tokens themselves (ADR 0020).
      if (refresh !== undefined) await client.revoke(refresh.token);
      return redirect(client.logoutUrl(), clearSession());
    },

    session: (request) => readSession(request, { client, cookies, seconds }),
  };
};
