import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { createAssistant } from "./assistant/assistant.ts";
import { createBedrockModel } from "./assistant/bedrock-model.ts";
import { createLimits, createRedisCounter } from "./assistant/limits.ts";
import { createAuth, type Auth } from "./auth.ts";
import type { Context } from "./api.ts";
import { createSealedCookies } from "./cookies.ts";
import { createOAuthClient } from "./oauth-client.ts";
import { createPostGraphql } from "./post-graphql.ts";
import { createRouterClient } from "./router-client.ts";
import { createSandboxClient } from "./sandbox-client.ts";
import { readSettings, type AiSettings } from "./settings.ts";

// A local run talks to the stand-in, and signs with these test values, so the SDK never reads the
// machine's own AWS credentials (A-17). Unset, the SDK finds the task role's (GR-5).
const LOCAL_CREDENTIALS = { accessKeyId: "test-local-key", secretAccessKey: "test-local-secret" };

const createAssistantFor = (ai: AiSettings) =>
  createAssistant({
    model: createBedrockModel({
      client: new BedrockRuntimeClient({
        region: ai.region,
        maxAttempts: 2,
        ...(ai.endpoint !== undefined && { endpoint: ai.endpoint, credentials: LOCAL_CREDENTIALS }),
      }),
      modelId: ai.modelId,
    }),
    limits: createLimits({ counter: createRedisCounter(ai.redisUrl) }),
  });

export interface Runtime {
  /** What every call shares. Each call adds its own session. */
  base: Omit<Context, "accessToken">;
  /** Sign-in, if the server has a user pool. */
  auth: Auth | undefined;
}

/** The server's parts, built from its settings and the network. */
export const createRuntime = (
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
      assistant: settings.ai && createAssistantFor(settings.ai),
    },
    auth,
  };
};

let runtime: Runtime | undefined;

// Built on the first request, because `next build` loads the routes with no settings.
export const serverRuntime = (): Runtime => (runtime ??= createRuntime(process.env, fetch));
