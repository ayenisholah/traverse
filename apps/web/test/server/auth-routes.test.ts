import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startIssuer, type Issuer } from "../../../../router/test/support/issuer.ts";

const APP = "http://127.0.0.1:4999";
const RESOURCE = "https://router.traverse.test";

let issuer: Issuer;

beforeAll(async () => {
  issuer = await startIssuer({
    clientId: "traverse-web",
    clientSecret: "local-secret",
    resource: RESOURCE,
    redirectUris: [`${APP}/auth/callback`],
    logoutUris: [`${APP}/`],
  });
});

afterAll(async () => {
  await issuer.stop();
});

const routers = {
  PUBLIC_ROUTER_URL: "http://127.0.0.1:3902",
  SANDBOX_ROUTER_URL: "http://127.0.0.1:3904",
};
const authSettings = () => ({
  APP_ORIGIN: APP,
  AUTH_DOMAIN_URL: issuer.url,
  AUTH_CLIENT_ID: "traverse-web",
  AUTH_CLIENT_SECRET: "local-secret",
  AUTH_RESOURCE: RESOURCE,
  SESSION_KEY: Buffer.alloc(32, 9).toString("base64url"),
});

/** The routes as the server build runs them, each time with a fresh runtime and these settings. */
const routes = async (env: Record<string, string>) => {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return {
    signIn: (await import("../../src/app/sign-in/route.live.ts")).GET,
    callback: (await import("../../src/app/auth/callback/route.live.ts")).GET,
    signOut: (await import("../../src/app/sign-out/route.live.ts")).POST,
    api: (await import("../../src/app/api/trpc/[trpc]/route.live.ts")).GET,
  };
};

/** A browser's cookie jar, as far as these routes need one. */
const jar = () => {
  const held = new Map<string, string>();
  return {
    take: (response: Response) => {
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";") as [string];
        const at = pair.indexOf("=");
        const [name, value] = [pair.slice(0, at), pair.slice(at + 1)];
        if (value === "") held.delete(name);
        else held.set(name, value);
      }
    },
    header: () => [...held].map(([name, value]) => `${name}=${value}`).join("; "),
    names: () => [...held.keys()],
  };
};

/** Signs in at the local issuer the way a browser would: its form, then back to the app. */
const signIn = async (app: Awaited<ReturnType<typeof routes>>, username = "ada") => {
  const cookies = jar();
  const start = await app.signIn(new Request(`${APP}/sign-in?returnTo=/impact`));
  cookies.take(start);
  const authorize = new URL(start.headers.get("location") ?? "");
  const page = await fetch(authorize);
  expect(await page.text()).toContain("Local sign-in");
  const form = new URLSearchParams({ ...Object.fromEntries(authorize.searchParams), username });
  const signedIn = await fetch(`${issuer.url}/oauth2/authorize`, {
    method: "POST",
    body: form,
    redirect: "manual",
  });
  const back = new URL(signedIn.headers.get("location") ?? "");
  const done = await app.callback(new Request(back, { headers: { cookie: cookies.header() } }));
  cookies.take(done);
  return { cookies, done };
};

const viewer = async (app: Awaited<ReturnType<typeof routes>>, cookie: string) => {
  const answer = await app.api(new Request(`${APP}/api/trpc/viewer`, { headers: { cookie } }));
  return { answer, body: (await answer.json()) as unknown };
};

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("the sign-in routes", () => {
  it("[FR-WB-10] sign in with code and PKCE, then hold only sealed cookies", async () => {
    const app = await routes({ ...routers, ...authSettings() });
    const { cookies, done } = await signIn(app);

    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(`${APP}/impact`);
    expect(cookies.names().sort()).toEqual(["traverse-access", "traverse-session"]);
    expect((await viewer(app, cookies.header())).body).toEqual({
      result: { data: { canSignIn: true, signedIn: true } },
    });
  });

  it("[FR-WB-10] refreshes the session once the access token has gone", async () => {
    const app = await routes({ ...routers, ...authSettings() });
    const { cookies } = await signIn(app);
    const before = issuer.refreshes();
    const withoutAccess = cookies
      .header()
      .split("; ")
      .filter((cookie) => !cookie.startsWith("traverse-access="))
      .join("; ");
    const { answer, body } = await viewer(app, withoutAccess);

    expect(issuer.refreshes()).toBe(before + 1);
    expect(body).toEqual({ result: { data: { canSignIn: true, signedIn: true } } });
    expect(answer.headers.getSetCookie()).toEqual([expect.stringMatching(/^traverse-access=/)]);
  });

  it("[FR-WB-10] signs out: the refresh token is revoked, and the session ends", async () => {
    const app = await routes({ ...routers, ...authSettings() });
    const { cookies } = await signIn(app);
    const out = await app.signOut(
      new Request(`${APP}/sign-out`, {
        method: "POST",
        headers: { cookie: cookies.header(), origin: APP },
      }),
    );
    cookies.take(out);

    expect(issuer.revoked.size).toBeGreaterThan(0);
    expect(cookies.names()).toEqual([]);
    const logout = await fetch(out.headers.get("location") ?? "", { redirect: "manual" });
    expect(logout.headers.get("location")).toBe(`${APP}/`);
    expect((await viewer(app, cookies.header())).body).toEqual({
      result: { data: { canSignIn: true, signedIn: false } },
    });
  });

  it("[FR-WB-10] can't sign in where the server has no user pool", async () => {
    const app = await routes(routers);

    expect((await app.signIn(new Request(`${APP}/sign-in`))).status).toBe(404);
    expect((await app.callback(new Request(`${APP}/auth/callback?code=c`))).status).toBe(404);
    expect((await app.signOut(new Request(`${APP}/sign-out`, { method: "POST" }))).status).toBe(
      404,
    );
    expect((await viewer(app, "")).body).toEqual({
      result: { data: { canSignIn: false, signedIn: false } },
    });
  });

  it("[GR-9] gives the browser nothing it can read: no token in any cookie or answer", async () => {
    const app = await routes({ ...routers, ...authSettings() });
    const { cookies } = await signIn(app);
    const token = await issuer.token();
    const { body } = await viewer(app, cookies.header());
    const everything = `${cookies.header()} ${JSON.stringify(body)}`;

    // Each access token starts with the same header, so this would find one if it leaked.
    expect(everything).not.toContain(token.split(".")[0]);
  });
});
