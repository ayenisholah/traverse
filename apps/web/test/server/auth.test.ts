import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../../src/server/auth.ts";
import { createSealedCookies } from "../../src/server/cookies.ts";
import type { OAuthClient } from "../../src/server/oauth-client.ts";

const APP = "https://traverse.example";

const fakeClient = (overrides: Partial<OAuthClient> = {}): OAuthClient => ({
  authorizeUrl: (state, challenge) =>
    `https://auth.example/oauth2/authorize?state=${state}&code_challenge=${challenge}`,
  redeem: vi.fn(() =>
    Promise.resolve({ accessToken: "access-1", refreshToken: "refresh-1", expiresIn: 3600 }),
  ),
  refresh: vi.fn(() =>
    Promise.resolve({ kind: "refreshed" as const, accessToken: "access-2", expiresIn: 3600 }),
  ),
  revoke: vi.fn(() => Promise.resolve(true)),
  logoutUrl: () => "https://auth.example/logout",
  ...overrides,
});

const setup = (overrides: Partial<OAuthClient> = {}) => {
  const client = fakeClient(overrides);
  const cookies = createSealedCookies({ key: new Uint8Array(32).fill(3), secure: true });
  let n = 0;
  const auth = createAuth({
    appOrigin: APP,
    client,
    cookies,
    random: () => `random-${String(++n)}`,
  });
  return { auth, client, cookies };
};

const setCookies = (response: Response) => response.headers.getSetCookie();

afterEach(() => {
  vi.useRealTimers();
});

const HOUR_MS = 60 * 60 * 1000;

/** The request a browser sends next, carrying the cookies an answer set. */
const carrying = (url: string, ...answers: Response[]) => {
  const jar = new Map<string, string>();
  for (const cookie of answers.flatMap(setCookies)) {
    const [pair] = cookie.split(";") as [string];
    const [name, value] = pair.split("=") as [string, string];
    if (value === "") jar.delete(name);
    else jar.set(name, value);
  }
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  return new Request(url, { headers: { cookie, origin: APP } });
};

const signedIn = async (overrides: Partial<OAuthClient> = {}) => {
  const context = setup(overrides);
  const start = await context.auth.signIn(new Request(`${APP}/sign-in`));
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
  const back = await context.auth.callback(
    carrying(`${APP}/auth/callback?code=code-1&state=${String(state)}`, start),
  );
  return { ...context, start, back };
};

describe("sign-in", () => {
  it("[FR-WB-10] sends the browser to the user pool with a state and an S256 challenge", async () => {
    const { auth } = setup();
    const answer = await auth.signIn(new Request(`${APP}/sign-in`));
    const location = new URL(answer.headers.get("location") ?? "");

    expect(answer.status).toBe(303);
    expect(location.searchParams.get("state")).toBe("random-1");
    expect(location.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update("random-2").digest("base64url"),
    );
    // The verifier itself stays in the sealed cookie.
    expect(answer.headers.get("location")).not.toContain("random-2");
    expect(setCookies(answer)).toEqual([
      expect.stringMatching(/^__Host-traverse-flow=.*Max-Age=600;/),
    ]);
  });

  it("[FR-WB-10] redeems the code with the verifier, and holds the tokens in sealed cookies", async () => {
    const { back, client } = await signedIn();

    expect(client.redeem).toHaveBeenCalledWith("code-1", "random-2");
    expect(back.status).toBe(303);
    expect(back.headers.get("location")).toBe(`${APP}/`);
    const cookies = setCookies(back);
    expect(cookies[0]).toMatch(/^__Host-traverse-flow=; Max-Age=0/);
    expect(cookies[1]).toMatch(/^__Host-traverse-access=.*Max-Age=3540;/);
    expect(cookies[2]).toMatch(/^__Host-traverse-session=.*Max-Age=43200;/);
    expect(cookies.join()).not.toMatch(/access-1|refresh-1/);
  });

  it("[FR-WB-10] goes back to the page that asked, if it's a page of this app", async () => {
    const { auth } = setup();
    const start = await auth.signIn(new Request(`${APP}/sign-in?returnTo=/impact`));
    const back = await auth.callback(carrying(`${APP}/auth/callback?code=c&state=random-1`, start));

    expect(back.headers.get("location")).toBe(`${APP}/impact`);
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/a?b=c", "/../x"])(
    "[FR-WB-10] goes home instead of to %s",
    async (returnTo) => {
      const { auth } = setup();
      const start = await auth.signIn(
        new Request(`${APP}/sign-in?returnTo=${encodeURIComponent(returnTo)}`),
      );
      const back = await auth.callback(
        carrying(`${APP}/auth/callback?code=c&state=random-1`, start),
      );

      expect(back.headers.get("location")).toBe(`${APP}/`);
    },
  );

  it.each([
    ["another state", "code=c&state=random-9", true],
    ["no state", "code=c", true],
    ["no code", "state=random-1", true],
    ["the user pool's error", "error=access_denied&state=random-1", true],
    ["no flow cookie", "code=c&state=random-1", false],
  ])("[FR-WB-10] refuses a callback with %s", async (_, query, withFlow) => {
    const { auth, client } = setup();
    const start = await auth.signIn(new Request(`${APP}/sign-in`));
    const request = withFlow
      ? carrying(`${APP}/auth/callback?${query}`, start)
      : new Request(`${APP}/auth/callback?${query}`);
    const answer = await auth.callback(request);

    expect(answer.headers.get("location")).toBe(`${APP}/auth/failed`);
    expect(client.redeem).not.toHaveBeenCalled();
    expect(setCookies(answer).join()).not.toContain("traverse-access=");
    // An abandoned attempt can't be finished later from the same browser.
    expect(setCookies(answer)).toEqual([
      expect.stringMatching(/^__Host-traverse-flow=; Max-Age=0/),
    ]);
  });

  it("[FR-WB-10] sends a forged state of any characters to the failed page, never an error", async () => {
    const { auth, client } = setup();
    const start = await auth.signIn(new Request(`${APP}/sign-in`));
    // As many characters as the real state, in more bytes.
    const forged = encodeURIComponent(`é${"a".repeat("random-1".length - 1)}`);
    const answer = await auth.callback(
      carrying(`${APP}/auth/callback?code=c&state=${forged}`, start),
    );

    expect(answer.headers.get("location")).toBe(`${APP}/auth/failed`);
    expect(client.redeem).not.toHaveBeenCalled();
  });

  it("[FR-WB-10] refuses a callback whose code the user pool won't redeem", async () => {
    const { back } = await signedIn({ redeem: () => Promise.resolve(undefined) });

    expect(back.headers.get("location")).toBe(`${APP}/auth/failed`);
  });
});

describe("the session", () => {
  it("[FR-WB-10] has no user without cookies", async () => {
    const { auth } = setup();

    expect(await auth.session(new Request(`${APP}/`))).toEqual({
      accessToken: undefined,
      setCookies: [],
    });
  });

  it("[FR-WB-10] reads the access token while it lasts", async () => {
    const { auth, back, client } = await signedIn();

    expect(await auth.session(carrying(`${APP}/`, back))).toEqual({
      accessToken: "access-1",
      setCookies: [],
    });
    expect(client.refresh).not.toHaveBeenCalled();
  });

  it("[FR-WB-10] refreshes the access token once it has gone", async () => {
    const { auth, back, client } = await signedIn();
    const request = carrying(
      `${APP}/`,
      back,
      new Response(null, { headers: { "set-cookie": "__Host-traverse-access=" } }),
    );
    const session = await auth.session(request);

    expect(client.refresh).toHaveBeenCalledWith("refresh-1");
    expect(session.accessToken).toBe("access-2");
    expect(session.setCookies).toEqual([expect.stringMatching(/^__Host-traverse-access=/)]);
  });

  it("[FR-WB-10] keeps the session when the user pool doesn't answer, to try again next time", async () => {
    const { auth, back } = await signedIn({
      refresh: () => Promise.resolve({ kind: "unavailable" as const }),
    });
    const request = carrying(
      `${APP}/`,
      back,
      new Response(null, { headers: { "set-cookie": "__Host-traverse-access=" } }),
    );

    expect(await auth.session(request)).toEqual({ accessToken: undefined, setCookies: [] });
  });

  it("[FR-WB-10] never lets a refresh carry the session past 12 hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { auth, back, client } = await signedIn();

    vi.setSystemTime(Date.now() + 12 * HOUR_MS - 10 * 60 * 1000);
    const late = await auth.session(carrying(`${APP}/`, back));
    expect(late.accessToken).toBe("access-2");
    // Ten minutes left, so the new access cookie lasts ten minutes, not the token's hour.
    expect(late.setCookies).toEqual([expect.stringMatching(/Max-Age=600;/)]);

    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect(await auth.session(carrying(`${APP}/`, back))).toEqual({
      accessToken: undefined,
      setCookies: [],
    });
    expect(client.refresh).toHaveBeenCalledOnce();
  });

  it("[FR-WB-10] ends a session whose time is up without asking the user pool", async () => {
    const { auth, cookies, client } = setup();
    const expired = await cookies.seal(
      "traverse-session",
      { token: "refresh-1", until: Math.floor(Date.now() / 1000) - 1 },
      60,
    );
    const session = await auth.session(
      carrying(`${APP}/`, new Response(null, { headers: { "set-cookie": expired } })),
    );

    expect(session.accessToken).toBeUndefined();
    expect(session.setCookies).toHaveLength(2);
    expect(client.refresh).not.toHaveBeenCalled();
  });

  it("[FR-WB-10] ends the session when the refresh token is refused", async () => {
    const { auth, back } = await signedIn({
      refresh: () => Promise.resolve({ kind: "refused" as const }),
    });
    const request = carrying(
      `${APP}/`,
      back,
      new Response(null, { headers: { "set-cookie": "__Host-traverse-access=" } }),
    );
    const session = await auth.session(request);

    expect(session.accessToken).toBeUndefined();
    expect(session.setCookies).toEqual([
      expect.stringMatching(/^__Host-traverse-access=; Max-Age=0/),
      expect.stringMatching(/^__Host-traverse-session=; Max-Age=0/),
    ]);
  });
});

describe("sign-out", () => {
  it("[FR-WB-10] revokes the refresh token, clears the cookies and signs out of the user pool", async () => {
    const { auth, back, client } = await signedIn();
    const answer = await auth.signOut(carrying(`${APP}/sign-out`, back));

    expect(client.revoke).toHaveBeenCalledWith("refresh-1");
    expect(answer.status).toBe(303);
    expect(answer.headers.get("location")).toBe("https://auth.example/logout");
    expect(setCookies(answer)).toEqual([
      expect.stringMatching(/^__Host-traverse-access=; Max-Age=0/),
      expect.stringMatching(/^__Host-traverse-session=; Max-Age=0/),
    ]);
  });

  it("[FR-WB-10] still clears the cookies when the user pool doesn't answer", async () => {
    const { auth, back } = await signedIn({ revoke: () => Promise.resolve(false) });
    const answer = await auth.signOut(carrying(`${APP}/sign-out`, back));

    expect(setCookies(answer)).toHaveLength(2);
  });

  it("[FR-WB-10] signs out with nothing to revoke when nobody is signed in", async () => {
    const { auth, client } = setup();
    const answer = await auth.signOut(new Request(`${APP}/sign-out`, { headers: { origin: APP } }));

    expect(client.revoke).not.toHaveBeenCalled();
    expect(answer.status).toBe(303);
  });

  it.each([
    ["another site", "https://evil.example"],
    ["no origin", null],
  ])("[FR-WB-10] refuses a sign-out from %s", async (_, origin) => {
    const { auth, back, client } = await signedIn();
    const request = carrying(`${APP}/sign-out`, back);
    const headers = new Headers(request.headers);
    if (origin === null) headers.delete("origin");
    else headers.set("origin", origin);
    const answer = await auth.signOut(new Request(request.url, { headers }));

    expect(answer.status).toBe(403);
    expect(client.revoke).not.toHaveBeenCalled();
    expect(setCookies(answer)).toEqual([]);
  });
});
