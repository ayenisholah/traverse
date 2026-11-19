import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";

/**
 * A stand-in for a Cognito user pool's OAuth 2.0 endpoints, for tests and local runs only. It
 * follows the documented behaviour (A-10, A-12 to A-14): codes with PKCE `S256` that last five
 * minutes, an access token bound to the requested resource, refresh without rotation, a revoke
 * endpoint that answers 200 for any token, and `/logout` to a registered address. It issues no ID
 * token, as Traverse never asks for one.
 */
export interface IssuerOptions {
  clientId: string;
  clientSecret: string;
  /** The `resource` the app must ask for, which becomes the access token's `aud`. */
  resource: string;
  redirectUris: string[];
  logoutUris: string[];
  /** How long an access token lasts. Cognito allows 5 minutes to a day (A-10). */
  accessTokenSeconds?: number;
}

export interface TokenOptions {
  sub?: string;
  audience?: string;
  /** A jose time span, such as "1h" or "-1h". */
  expires?: string;
  key?: CryptoKey;
  tokenUse?: string;
}

export interface Issuer {
  /** The issuer's origin, which is also the tokens' `iss`. */
  url: string;
  jwksUrl: string;
  /** Signs an access token directly, for tests that skip the browser. */
  token: (options?: TokenOptions) => Promise<string>;
  /** Each refresh token the issuer has revoked. */
  revoked: Set<string>;
  /** How many refresh grants it has served. */
  refreshes: () => number;
  stop: () => Promise<void>;
}

interface Code {
  sub: string;
  redirectUri: string;
  challenge: string;
  resource: string;
  expiresAt: number;
}

const CODE_MS = 5 * 60 * 1000;
// Cognito's refresh tokens are long. One of this size proves the app's cookies still fit.
const REFRESH_TOKEN_BYTES = 1_300;

const readBody = async (request: IncomingMessage): Promise<URLSearchParams> => {
  let text = "";
  request.on("data", (chunk: Buffer) => (text += chunk.toString()));
  await once(request, "end");
  return new URLSearchParams(text);
};

const send = (response: ServerResponse, status: number, body: unknown) =>
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

const redirect = (response: ServerResponse, location: string) =>
  response.writeHead(302, { location }).end();

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);

const signInPage = (fields: Record<string, string>) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Local sign-in</title></head>
<body><main><h1>Local sign-in</h1>
<form method="post" action="/oauth2/authorize">
${Object.entries(fields)
  .map(([name, value]) => `<input type="hidden" name="${name}" value="${escape(value)}">`)
  .join("\n")}
<label for="username">Username</label>
<input id="username" name="username" required autocomplete="off">
<button type="submit">Sign in</button>
</form></main></body></html>`;

// The same name always gets the same subject, so a user can come back to their work.
const subjectFor = (username: string) =>
  createHash("sha256").update(`local:${username}`).digest("hex").slice(0, 32);

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export const startIssuer = async (options: IssuerOptions): Promise<Issuer> => {
  const { clientId, clientSecret, resource, redirectUris, logoutUris } = options;
  const accessTokenSeconds = options.accessTokenSeconds ?? 3600;
  const keys = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "local", alg: "RS256", use: "sig" };
  const codes = new Map<string, Code>();
  const refreshTokens = new Map<string, { sub: string; resource: string }>();
  const revoked = new Set<string>();
  let refreshes = 0;
  let url = "";

  const sign = ({
    sub = "local-user",
    audience = resource,
    expires = `${String(accessTokenSeconds)}s`,
    key = keys.privateKey,
    tokenUse = "access",
  }: TokenOptions = {}) =>
    new SignJWT({ client_id: clientId, token_use: tokenUse, scope: "traverse/workspace" })
      .setProtectedHeader({ alg: "RS256", kid: "local" })
      .setSubject(sub)
      .setIssuer(url)
      .setAudience(audience)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(expires)
      .sign(key);

  const isClient = (request: IncomingMessage) =>
    request.headers.authorization ===
    `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;

  const authorize = (query: URLSearchParams, response: ServerResponse) => {
    const redirectUri = query.get("redirect_uri") ?? "";
    if (query.get("client_id") !== clientId || !redirectUris.includes(redirectUri)) {
      send(response, 400, { error: "invalid_request" });
      return;
    }
    const fail = (error: string) => redirect(response, `${redirectUri}?error=${error}`);
    if (query.get("response_type") !== "code") return fail("unsupported_response_type");
    if (query.get("code_challenge_method") !== "S256" || !query.get("code_challenge")) {
      return fail("invalid_request");
    }
    if (query.get("resource") !== resource) return fail("invalid_target");
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(signInPage(Object.fromEntries(query)));
  };

  const signIn = (form: URLSearchParams, response: ServerResponse) => {
    const redirectUri = form.get("redirect_uri") ?? "";
    if (form.get("client_id") !== clientId || !redirectUris.includes(redirectUri)) {
      send(response, 400, { error: "invalid_request" });
      return;
    }
    const code = randomUUID();
    codes.set(code, {
      sub: subjectFor(form.get("username") ?? ""),
      redirectUri,
      challenge: form.get("code_challenge") ?? "",
      resource: form.get("resource") ?? "",
      expiresAt: Date.now() + CODE_MS,
    });
    const state = form.get("state");
    const query = new URLSearchParams({ code, ...(state === null ? {} : { state }) });
    redirect(response, `${redirectUri}?${query.toString()}`);
  };

  const issue = async (sub: string, refreshToken?: string) => ({
    access_token: await sign({ sub }),
    ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
    token_type: "Bearer",
    expires_in: accessTokenSeconds,
  });

  const token = async (form: URLSearchParams, response: ServerResponse) => {
    if (form.get("grant_type") === "authorization_code") {
      const code = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      if (code === undefined || code.expiresAt < Date.now()) {
        send(response, 400, { error: "invalid_grant" });
        return;
      }
      if (code.redirectUri !== form.get("redirect_uri")) {
        send(response, 400, {
          error: "unauthorized_client",
          error_description: "invalid_redirect",
        });
        return;
      }
      if (s256(form.get("code_verifier") ?? "") !== code.challenge) {
        send(response, 400, { error: "invalid_grant" });
        return;
      }
      const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
      refreshTokens.set(refreshToken, { sub: code.sub, resource: code.resource });
      send(response, 200, await issue(code.sub, refreshToken));
      return;
    }
    if (form.get("grant_type") === "refresh_token") {
      const refreshToken = form.get("refresh_token") ?? "";
      const held = refreshTokens.get(refreshToken);
      if (held === undefined || revoked.has(refreshToken)) {
        send(response, 400, { error: "invalid_grant" });
        return;
      }
      refreshes += 1;
      send(response, 200, await issue(held.sub));
      return;
    }
    send(response, 400, { error: "unsupported_grant_type" });
  };

  const server = createServer((request, response) => {
    const address = new URL(request.url ?? "/", "http://issuer");
    const route = `${request.method ?? ""} ${address.pathname}`;
    const handle = async () => {
      if (route === "GET /.well-known/jwks.json") return send(response, 200, { keys: [jwk] });
      if (route === "GET /oauth2/authorize") return authorize(address.searchParams, response);
      if (route === "POST /oauth2/authorize") return signIn(await readBody(request), response);
      if (route === "POST /oauth2/token" || route === "POST /oauth2/revoke") {
        if (!isClient(request)) return send(response, 401, { error: "invalid_client" });
        const form = await readBody(request);
        if (route === "POST /oauth2/token") return token(form, response);
        revoked.add(form.get("token") ?? "");
        return response.writeHead(200).end();
      }
      if (route === "GET /logout") {
        const target = address.searchParams.get("logout_uri") ?? "";
        const known = address.searchParams.get("client_id") === clientId;
        if (known && logoutUris.includes(target)) return redirect(response, target);
        return send(response, 400, { error: "invalid_request" });
      }
      return send(response, 404, { error: "not_found" });
    };
    handle().catch(() => send(response, 500, { error: "server_error" }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  return {
    url,
    jwksUrl: `${url}/.well-known/jwks.json`,
    token: sign,
    revoked,
    refreshes: () => refreshes,
    stop: async () => {
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    },
  };
};
