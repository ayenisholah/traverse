import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { startModelStub, type ModelStub } from "../../../../../router/test/support/model-stub.ts";
import { fixed } from "../../../src/server/assistant/prompt.ts";
import { createRuntime } from "../../../src/server/runtime.ts";
import { fakeRedis } from "../../support/fake-redis.ts";

let stub: ModelStub;
let redis: Awaited<ReturnType<typeof fakeRedis>>;

beforeAll(async () => {
  stub = await startModelStub();
  redis = await fakeRedis("*2\r\n:1\r\n:1\r\n");
});

afterAll(async () => {
  await stub.stop();
  redis.server.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const PLANTED = "test-planted-person@example.com";
// Built from parts, so the source holds nothing a secret scanner takes for a real key.
const MACHINE_KEY = ["AKIA", "TESTMACHINEKEY01"].join("");
const env = () => ({
  PUBLIC_ROUTER_URL: "http://127.0.0.1:3902",
  SANDBOX_ROUTER_URL: "http://127.0.0.1:3904",
  APP_ORIGIN: "http://127.0.0.1:4999",
  AUTH_DOMAIN_URL: "http://127.0.0.1:4998",
  AUTH_CLIENT_ID: "traverse-web",
  AUTH_CLIENT_SECRET: "test-client-secret",
  AUTH_RESOURCE: "https://router.traverse.test",
  SESSION_KEY: Buffer.alloc(32, 6).toString("base64url"),
  AI_MODEL_ID: "eu.test.model-v1:0",
  AI_REGION: "eu-north-1",
  REDIS_URL: redis.url,
  AI_ENDPOINT: stub.url,
});

const question = {
  task: fixed`Explain composition errors.`,
  instructions: fixed`Explain the errors below.`,
  data: { errors: `Field Query.a is defined twice. Ask ${PLANTED}.` },
  schema: z.strictObject({ summary: z.string() }),
};

/** Everything the process writes while `run` runs. */
const output = async (run: () => Promise<unknown>) => {
  const written: string[] = [];
  const capture = (chunk: unknown) => {
    written.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capture);
  vi.spyOn(process.stderr, "write").mockImplementation(capture);
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation(
      (...args: unknown[]) => void capture(args.join(" ")),
    );
  }
  await run();
  vi.restoreAllMocks();
  return written.join("\n");
};

describe("the assistant the server builds", () => {
  it("[GR-5] signs local calls with test values, never the machine's own AWS credentials", async () => {
    // What a developer's shell might hold. The SDK would read these if the server let it (A-17).
    vi.stubEnv("AWS_ACCESS_KEY_ID", MACHINE_KEY);
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-machine-secret");
    stub.reply({ kind: "tool", input: { summary: "It's defined twice." } });
    const { base } = createRuntime(env(), fetch);

    expect(await base.assistant?.ask("user-1", question)).toEqual({
      kind: "answer",
      value: { summary: "It's defined twice." },
    });
    const call = stub.calls.at(-1);
    expect(call?.authorization).toContain("Credential=test-local-key/");
    expect(call?.authorization).not.toContain(MACHINE_KEY);
  });

  it("[GR-14] writes nothing about a call, answered or failed, and sends no planted email", async () => {
    const { base } = createRuntime(env(), fetch);
    stub.reply({ kind: "tool", input: { summary: `It's defined twice. ${PLANTED}` } });
    const answered = await output(
      () => base.assistant?.ask("user-1", question) ?? Promise.resolve(),
    );
    stub.reply({ kind: "error", status: 500, type: "InternalServerException" });
    const failed = await output(() => base.assistant?.ask("user-1", question) ?? Promise.resolve());

    expect(answered).toBe("");
    expect(failed).toBe("");
    expect(stub.calls.at(-1)?.prompt).not.toContain(PLANTED);
  });

  it("[FR-AI-4] has no assistant without its settings", () => {
    const without = Object.fromEntries(
      Object.entries(env()).filter(([name]) => !name.startsWith("AI_") && name !== "REDIS_URL"),
    );

    expect(createRuntime(without, fetch).base.assistant).toBeUndefined();
  });
});
