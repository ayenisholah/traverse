import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createSealedCookies } from "../../src/server/cookies.ts";

const key = new Uint8Array(32).fill(1);
const schema = z.object({ token: z.string() });

/** A request carrying the cookie a `Set-Cookie` value sets. */
const sending = (...setCookies: string[]) =>
  new Request("https://traverse.example/", {
    headers: { cookie: setCookies.map((value) => value.split(";")[0]).join("; ") },
  });

describe("createSealedCookies", () => {
  it("[GR-9] seals a value the browser can't read, and opens it again", async () => {
    const cookies = createSealedCookies({ key, secure: true });
    const set = await cookies.seal("session", { token: "secret-token" }, 60);

    expect(set).not.toContain("secret-token");
    expect(await cookies.open(sending(set), "session", schema)).toEqual({ token: "secret-token" });
  });

  it("[GR-9] keeps it from scripts and other sites, and on HTTPS pins it to this host", async () => {
    const set = await createSealedCookies({ key, secure: true }).seal(
      "session",
      { token: "t" },
      60,
    );

    expect(set).toMatch(/^__Host-session=/);
    expect(set).toContain("; Max-Age=60; Path=/; HttpOnly; SameSite=Lax; Secure");
  });

  it("[FR-WB-10] drops the prefix and Secure on plain HTTP, which is only ever this machine", async () => {
    const set = await createSealedCookies({ key, secure: false }).seal(
      "session",
      { token: "t" },
      60,
    );

    expect(set).toMatch(/^session=/);
    expect(set).not.toContain("Secure");
  });

  it("[GR-9] opens nothing that was changed, or sealed with another key", async () => {
    const cookies = createSealedCookies({ key, secure: true });
    const set = await cookies.seal("session", { token: "t" }, 60);
    const [name, value] = (set.split(";")[0] as string).split("=") as [string, string];
    const changed = `${name}=${value.slice(0, -2)}${value.endsWith("AA") ? "BB" : "AA"}`;
    const other = createSealedCookies({ key: new Uint8Array(32).fill(2), secure: true });

    expect(await cookies.open(sending(changed), "session", schema)).toBeUndefined();
    expect(await other.open(sending(set), "session", schema)).toBeUndefined();
  });

  it("[FR-WB-10] opens nothing once it has expired, whatever the browser keeps", async () => {
    vi.useFakeTimers();
    try {
      const cookies = createSealedCookies({ key, secure: true });
      const set = await cookies.seal("session", { token: "t" }, 60);
      vi.advanceTimersByTime(61_000);

      expect(await cookies.open(sending(set), "session", schema)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("[FR-WB-10] opens nothing of the wrong shape, missing, or under another name", async () => {
    const cookies = createSealedCookies({ key, secure: true });
    const set = await cookies.seal("session", { token: 42 }, 60);

    expect(await cookies.open(sending(set), "session", schema)).toBeUndefined();
    expect(await cookies.open(new Request("https://traverse.example/"), "session", schema)).toBe(
      undefined,
    );
    expect(await cookies.open(sending(set), "flow", schema)).toBeUndefined();
  });

  it("[GR-9] opens nothing sealed for another cookie and replayed under this one's name", async () => {
    const cookies = createSealedCookies({ key, secure: true });
    const refresh = await cookies.seal("refresh", { token: "refresh-token" }, 60);
    const value = (refresh.split(";")[0] as string).split("=")[1] as string;
    const replayed = new Request("https://traverse.example/", {
      headers: { cookie: `__Host-access=${value}` },
    });

    expect(await cookies.open(replayed, "access", schema)).toBeUndefined();
  });

  it("[GR-9] opens nothing encrypted with another algorithm, even under the same key", async () => {
    const { EncryptJWT } = await import("jose");
    const wrapped = await new EncryptJWT({ token: "t", cookie: "session" })
      .setProtectedHeader({ alg: "A256KW", enc: "A256GCM" })
      .setExpirationTime("1m")
      .encrypt(key);
    const request = new Request("https://traverse.example/", {
      headers: { cookie: `__Host-session=${wrapped}` },
    });

    expect(await createSealedCookies({ key, secure: true }).open(request, "session", schema)).toBe(
      undefined,
    );
  });

  it("[FR-WB-10] reads its own cookie among others", async () => {
    const cookies = createSealedCookies({ key, secure: true });
    const set = await cookies.seal("session", { token: "t" }, 60);
    const request = new Request("https://traverse.example/", {
      headers: { cookie: `theme=dark; ${set.split(";")[0] as string}; other=1` },
    });

    expect(await cookies.open(request, "session", schema)).toEqual({ token: "t" });
  });

  it("[FR-WB-10] fits a token as long as a Cognito refresh token in one cookie", async () => {
    const set = await createSealedCookies({ key, secure: true }).seal(
      "refresh",
      { token: "x".repeat(2_000) },
      60,
    );

    // Browsers keep at most 4,096 bytes of name and value in one cookie.
    expect((set.split(";")[0] as string).length).toBeLessThan(4_096);
  });

  it("[FR-WB-10] clears a cookie with the attributes it was set with", () => {
    expect(createSealedCookies({ key, secure: true }).clear("session")).toBe(
      "__Host-session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure",
    );
  });
});
