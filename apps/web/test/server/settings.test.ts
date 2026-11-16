import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSettings } from "../../src/server/settings.ts";

describe("readSettings", () => {
  it.each(["http://127.0.0.1:3002", "https://router.internal", "http://router:3002"])(
    "accepts the origin %s",
    (url) => {
      expect(readSettings({ PUBLIC_ROUTER_URL: url })).toEqual({ publicRouterUrl: url });
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
  ])("refuses %s, and never repeats the value", (_, url) => {
    const read = () => readSettings({ PUBLIC_ROUTER_URL: url });

    expect(read).toThrow("Set PUBLIC_ROUTER_URL to the public router's origin");
    expect(read).not.toThrow(/secret|passwd|elsewhere/);
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
