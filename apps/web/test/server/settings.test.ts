import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSettings } from "../../src/server/settings.ts";

describe("readSettings", () => {
  it.each(["http://127.0.0.1:3002", "https://router.internal", "http://router:3002"])(
    "accepts the origin %s",
    (url) => {
      expect(readSettings({ PUBLIC_ROUTER_URL: url, SANDBOX_ROUTER_URL: url })).toEqual({
        publicRouterUrl: url,
        sandboxRouterUrl: url,
        auth: undefined,
        ai: undefined,
      });
    },
  );

  it.each([
    ["nothing", undefined],
    ["a path", "http://127.0.0.1:3002/graphql"],
    ["credentials", "https://user:secret@router.internal"],
    ["a query", "https://router.internal?key=secret"],
    ["another scheme", "file:///etc/passwd"],
    ["plain HTTP to a public host", "http://router.elsewhere.example"],
    ["a port that can't exist", "http://127.0.0.1:99999"],
    ["a trailing slash", "http://127.0.0.1:3002/"],
    ["a second line", "https://router.internal\nhttps://elsewhere.example"],
    ["plain HTTP to an IPv6 address", "http://[2606:4700:4700::1111]:3002"],
  ])("refuses %s, and never repeats the value", (_, url) => {
    const good = "http://127.0.0.1:3002";

    for (const env of [
      { PUBLIC_ROUTER_URL: url, SANDBOX_ROUTER_URL: good },
      { PUBLIC_ROUTER_URL: good, SANDBOX_ROUTER_URL: url },
    ]) {
      const read = () => readSettings(env);

      expect(read).toThrow("Set PUBLIC_ROUTER_URL and SANDBOX_ROUTER_URL to each router's origin");
      expect(read).not.toThrow(/secret|passwd|elsewhere/);
    }
  });

  const routers = {
    PUBLIC_ROUTER_URL: "http://127.0.0.1:3002",
    SANDBOX_ROUTER_URL: "http://127.0.0.1:3003",
  };
  const key = Buffer.alloc(32, 7).toString("base64url");
  const auth = {
    APP_ORIGIN: "https://traverse.example",
    AUTH_DOMAIN_URL: "https://auth.traverse.example",
    AUTH_CLIENT_ID: "1example23456789",
    AUTH_CLIENT_SECRET: "test-client-secret",
    AUTH_RESOURCE: "https://api.traverse.example",
    SESSION_KEY: key,
  };

  it("[FR-WB-10] reads sign-in settings that are all there", () => {
    expect(readSettings({ ...routers, ...auth }).auth).toEqual({
      appOrigin: "https://traverse.example",
      domainUrl: "https://auth.traverse.example",
      clientId: "1example23456789",
      clientSecret: "test-client-secret",
      resource: "https://api.traverse.example",
      sessionKey: new Uint8Array(32).fill(7),
    });
  });

  it("[FR-WB-10] accepts a local issuer and app over plain HTTP", () => {
    const local = { APP_ORIGIN: "http://127.0.0.1:4174", AUTH_DOMAIN_URL: "http://127.0.0.1:4999" };

    expect(readSettings({ ...routers, ...auth, ...local }).auth?.appOrigin).toBe(
      "http://127.0.0.1:4174",
    );
  });

  it.each([
    ["one of them left out", "AUTH_CLIENT_SECRET", undefined],
    ["an app origin with a path", "APP_ORIGIN", "https://traverse.example/app"],
    ["plain HTTP to a public user pool", "AUTH_DOMAIN_URL", "http://auth.traverse.example"],
    ["plain HTTP to a user pool by service name", "AUTH_DOMAIN_URL", "http://auth:4999"],
    ["plain HTTP to a user pool at an IPv6 address", "AUTH_DOMAIN_URL", "http://[2001:db8::1]"],
    ["an app served over plain HTTP by service name", "APP_ORIGIN", "http://web:3000"],
    ["a client ID with a space", "AUTH_CLIENT_ID", "1example 23456789"],
    ["a resource that isn't HTTPS", "AUTH_RESOURCE", "http://api.traverse.example"],
    ["a resource with a second line", "AUTH_RESOURCE", "https://api.traverse.example\nx"],
    ["a session key that's too short", "SESSION_KEY", Buffer.alloc(16).toString("base64url")],
    ["a session key that isn't base64url", "SESSION_KEY", `${key.slice(1)}+`],
  ])("[FR-WB-10] refuses %s, and never repeats a value", (_, name, value) => {
    const read = () => readSettings({ ...routers, ...auth, [name]: value });

    expect(read).toThrow("Set APP_ORIGIN, AUTH_DOMAIN_URL, AUTH_CLIENT_ID");
    expect(read).not.toThrow(/test-client-secret|example\/app|BwcH/);
  });

  const ai = {
    AI_MODEL_ID: "eu.test.model-v1:0",
    AI_REGION: "eu-north-1",
    REDIS_URL: "rediss://cache.traverse.example:6379",
  };

  it("[FR-AI-4] has no assistant without its settings", () => {
    expect(readSettings({ ...routers, ...auth }).ai).toBeUndefined();
  });

  it("[FR-AI-1] reads the assistant's settings, with a local stand-in or without one", () => {
    expect(readSettings({ ...routers, ...auth, ...ai }).ai).toEqual({
      modelId: "eu.test.model-v1:0",
      region: "eu-north-1",
      redisUrl: "rediss://cache.traverse.example:6379",
      endpoint: undefined,
    });
    const local = {
      ...ai,
      REDIS_URL: "redis://127.0.0.1:6379",
      AI_ENDPOINT: "http://127.0.0.1:4998",
    };
    expect(readSettings({ ...routers, ...auth, ...local }).ai?.endpoint).toBe(
      "http://127.0.0.1:4998",
    );
  });

  it.each([
    ["one of them left out", { AI_REGION: undefined }],
    ["a model ID with a space", { AI_MODEL_ID: "eu.test model" }],
    ["a region that isn't one", { AI_REGION: "europe" }],
    ["plain Redis to a public host", { REDIS_URL: "redis://cache.traverse.example:6379" }],
    ["Redis that isn't a URL", { REDIS_URL: "cache" }],
    ["a model endpoint that isn't this machine", { AI_ENDPOINT: "https://bedrock.example" }],
    ["a model endpoint with a path", { AI_ENDPOINT: "http://127.0.0.1:4998/x" }],
  ])("[FR-AI-4] refuses %s, and never repeats a value", (_, change) => {
    const read = () => readSettings({ ...routers, ...auth, ...ai, ...change });

    expect(read).toThrow("Set AI_MODEL_ID, AI_REGION and REDIS_URL together");
    expect(read).not.toThrow(/test model|europe|cache\.traverse|bedrock\.example/);
  });

  it("[GR-15] refuses an assistant where nobody can sign in, so every call counts against someone", () => {
    expect(() => readSettings({ ...routers, ...ai })).toThrow("with sign-in set up");
  });

  it("[GR-9] finds no variable in the app that Next.js would copy into the browser", () => {
    const app = join(import.meta.dirname, "../..");
    const sources = [
      "next.config.ts",
      ...readdirSync(join(app, "src"), { recursive: true, encoding: "utf8" })
        .filter((file) => /\.tsx?$/.test(file))
        .map((file) => join("src", file)),
    ];
    const reads = (text: string) => /process\.env\.NEXT_PUBLIC_|env\[["']NEXT_PUBLIC_/.test(text);

    expect(sources.length).toBeGreaterThan(10);
    expect(sources.filter((file) => reads(readFileSync(join(app, file), "utf8")))).toEqual([]);
    expect(reads("const url = process.env.NEXT_PUBLIC_ROUTER_URL;")).toBe(true);
  });
});
