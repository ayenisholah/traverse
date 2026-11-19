import { describe, expect, it, vi } from "vitest";
import { createOAuthClient } from "../../src/server/oauth-client.ts";
import type { AuthSettings } from "../../src/server/settings.ts";

const auth: AuthSettings = {
  appOrigin: "https://traverse.example",
  domainUrl: "https://auth.traverse.example",
  clientId: "client-1",
  clientSecret: "secret-1",
  resource: "https://api.traverse.example",
  sessionKey: new Uint8Array(32),
};

const answering = (respond: () => Response | Promise<Response>) =>
  vi.fn<typeof fetch>(() => Promise.resolve(respond()));

const json =
  (body: unknown, status = 200) =>
  () =>
    Response.json(body, { status });

const formOf = (fetch: ReturnType<typeof answering>) => {
  const init = fetch.mock.calls[0]?.[1];
  return Object.fromEntries(init?.body as URLSearchParams);
};

describe("createOAuthClient", () => {
  it("[FR-WB-10] sends the browser to sign in with PKCE, bound to the router, asking for no ID token", () => {
    const url = new URL(createOAuthClient(auth, fetch).authorizeUrl("state-1", "challenge-1"));

    expect(url.origin + url.pathname).toBe("https://auth.traverse.example/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client-1",
      redirect_uri: "https://traverse.example/auth/callback",
      state: "state-1",
      code_challenge_method: "S256",
      code_challenge: "challenge-1",
      resource: "https://api.traverse.example",
    });
  });

  it("[FR-WB-10] redeems a code with its verifier, as a confidential client", async () => {
    const fetch = answering(
      json({ access_token: "a", refresh_token: "r", expires_in: 3600, token_type: "Bearer" }),
    );

    expect(await createOAuthClient(auth, fetch).redeem("code-1", "verifier-1")).toEqual({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 3600,
    });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://auth.traverse.example/oauth2/token");
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`,
    });
    expect(formOf(fetch)).toEqual({
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: "https://traverse.example/auth/callback",
      code_verifier: "verifier-1",
    });
  });

  it("[FR-WB-10] refreshes an access token", async () => {
    const fetch = answering(json({ access_token: "a2", expires_in: 300 }));

    expect(await createOAuthClient(auth, fetch).refresh("r")).toEqual({
      kind: "refreshed",
      accessToken: "a2",
      expiresIn: 300,
    });
    expect(formOf(fetch)).toEqual({ grant_type: "refresh_token", refresh_token: "r" });
  });

  it.each([
    ["a refusal", json({ error: "invalid_grant" }, 400)],
    ["no refresh token", json({ access_token: "a", expires_in: 3600 })],
    [
      "an expiry that isn't a number",
      json({ access_token: "a", refresh_token: "r", expires_in: "1" }),
    ],
    ["an empty token", json({ access_token: "", refresh_token: "r", expires_in: 3600 })],
    ["a body that isn't JSON", () => new Response("<html>")],
    [
      "an answer far too large, though it would parse",
      json({
        access_token: "a",
        refresh_token: "r",
        expires_in: 3600,
        padding: "x".repeat(40_000),
      }),
    ],
    ["no answer at all", () => Promise.reject(new Error("connection refused"))],
  ])("[FR-WB-10] counts %s as no grant", async (_, respond) => {
    const client = createOAuthClient(auth, answering(respond));

    expect(await client.redeem("code-1", "verifier-1")).toBeUndefined();
  });

  it("[FR-WB-10] tells a refused refresh from a user pool that didn't answer", async () => {
    const refresh = (respond: () => Response | Promise<Response>) =>
      createOAuthClient(auth, answering(respond)).refresh("r");

    expect(await refresh(json({ error: "invalid_grant" }, 400))).toEqual({ kind: "refused" });
    for (const respond of [
      json({ error: "server_error" }, 500),
      () => Promise.reject(new Error("timed out")),
      json({ access_token: "a" }),
    ]) {
      expect(await refresh(respond)).toEqual({ kind: "unavailable" });
    }
  });

  it("[FR-WB-10] follows no redirect and waits a bounded time for the user pool", async () => {
    const fetch = answering(json({ access_token: "a2", expires_in: 300 }));
    await createOAuthClient(auth, fetch).refresh("r");
    const init = fetch.mock.calls[0]?.[1];

    // A redirect would send the client secret on to wherever it pointed.
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("[FR-WB-10] revokes a refresh token, and says whether the user pool took it", async () => {
    const fetch = answering(() => new Response(null, { status: 200 }));

    expect(await createOAuthClient(auth, fetch).revoke("r")).toBe(true);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://auth.traverse.example/oauth2/revoke");
    expect(formOf(fetch)).toEqual({ token: "r" });
    expect(await createOAuthClient(auth, answering(json({}, 401))).revoke("r")).toBe(false);
  });

  it("[FR-WB-10] signs the browser out of the user pool, and back to the app", () => {
    const url = new URL(createOAuthClient(auth, fetch).logoutUrl());

    expect(url.origin + url.pathname).toBe("https://auth.traverse.example/logout");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-1",
      logout_uri: "https://traverse.example/",
    });
  });
});
