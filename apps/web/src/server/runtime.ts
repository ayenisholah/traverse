import { createAuth, type Auth } from "./auth.ts";
import type { Context } from "./api.ts";
import { createSealedCookies } from "./cookies.ts";
import { createOAuthClient } from "./oauth-client.ts";
import { createPostGraphql } from "./post-graphql.ts";
import { createRouterClient } from "./router-client.ts";
import { createSandboxClient } from "./sandbox-client.ts";
import { readSettings } from "./settings.ts";

export interface Runtime {
  /** What every call shares. Each call adds its own session. */
  base: Omit<Context, "accessToken">;
  /** Sign-in, if the server has a user pool. */
  auth: Auth | undefined;
}

/** The server's parts, built from its settings and the network. */
const createRuntime = (
  env: Record<string, string | undefined>,
  fetch: typeof globalThis.fetch,
): Runtime => {
  const settings = readSettings(env);
  const auth =
    settings.auth &&
    createAuth({
      appOrigin: settings.auth.appOrigin,
      client: createOAuthClient(settings.auth, fetch),
      cookies: createSealedCookies({
        key: settings.auth.sessionKey,
        secure: settings.auth.appOrigin.startsWith("https://"),
      }),
    });
  return {
    base: {
      router: createRouterClient(createPostGraphql({ url: settings.publicRouterUrl, fetch })),
      sandbox: createSandboxClient(createPostGraphql({ url: settings.sandboxRouterUrl, fetch })),
      canSignIn: auth !== undefined,
    },
    auth,
  };
};

let runtime: Runtime | undefined;

// Built on the first request, because `next build` loads the routes with no settings.
export const serverRuntime = (): Runtime => (runtime ??= createRuntime(process.env, fetch));
