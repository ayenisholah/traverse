# 0020: Sign in with a server-held session and a bound access token

**Status:** Accepted

## Context

FR-WB-10 needs Cognito sign-in with authorization code and PKCE, sessions that expire and refresh, and a sign-out that ends them. GR-9 keeps tokens out of browser code, GR-3 takes the user ID only from a verified token, and GR-16 keeps maintainer emails out of Traverse, which an ID token would bring in (A-11).

U-22 asked whether a Cognito access token carries `aud`, which the router and `packages/subgraph-kit` both check. It does when the app asks for a resource binding, and a refresh keeps it (A-10, A-12).

The real user pool comes from CDK (GR-6), which isn't built yet. The owner chose on 2026-11-18 to build this against a local issuer first.

## Decision

- The web server is a confidential OAuth 2.0 client. It sends the browser to `/oauth2/authorize` with PKCE (`S256`), a random `state`, and `resource` set to the public router's audience, so the access token's `aud` is that URL (A-12, A-13). It asks for no `openid` scope, so Cognito issues no ID token and no email reaches Traverse.
- Only the access token goes to the router. `packages/subgraph-kit` also requires `token_use` to be `access`, so an ID token from the same pool can't stand in for one.
- The session is the two tokens, each encrypted with a server key (JWE, `dir` and `A256GCM`) into its own `HttpOnly`, `SameSite=Lax` cookie, `Secure` and `__Host-` prefixed on HTTPS, because a Cognito refresh token is long and one cookie holds at most 4,096 bytes. Each sealed value names its cookie, so one can't be replayed as the other. There's no session store. The flow's `state` and verifier sit in a third sealed cookie for ten minutes at most.
- The server refreshes the access token when it's near expiry. The session ends 12 hours after sign-in, a time sealed into the refresh cookie, and no access cookie outlives it. A refused refresh ends the session; a user pool that doesn't answer leaves it for the next request. A rotated refresh token would be dropped, so the app client keeps rotation off. Sign-out is a POST from the app's own origin: it revokes the refresh token, clears the cookie and sends the browser to `/logout` (A-14).
- The flow is written against the endpoints in A-13 and A-14, with `fetch` injected and every answer parsed by a strict schema, rather than with an OIDC library, because without ID tokens it's four requests.
- Tests and local runs use a local issuer that issues tokens shaped as A-10 describes. The real pool is proven when the auth stack deploys.

Rejected: ID tokens (they carry the email, A-11); a session table (it needs a store before M6, and the cookie holds no more than the session needs); `openid-client` (OIDC discovery and ID token checks this flow doesn't use).

## Consequences

- No personal data is held by the web server, and the browser only ever holds an encrypted cookie it can't read.
- A revoked refresh token can't recall an access token already issued, because the router and subgraphs verify tokens locally. Sign-out clears the cookie at once, and the access token's lifetime (5 minutes to a day, set per app client, A-10) bounds the rest. Keep it short in the CDK app client.
- Rotating the session key signs everyone out.
- FR-WB-10 isn't done until the flow runs against a real user pool.
