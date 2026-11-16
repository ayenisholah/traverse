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
    ["a second line", "https://router.internal\nhttps://elsewhere.example"],
  ])("refuses %s, and never repeats the value", (_, url) => {
    const read = () => readSettings({ PUBLIC_ROUTER_URL: url });

    expect(read).toThrow("Set PUBLIC_ROUTER_URL to the public router's origin");
    expect(read).not.toThrow(/secret|passwd|elsewhere/);
  });

  it("[GR-9] reads no setting that Next.js would copy into the browser", () => {
    const settings = readSettings({
      PUBLIC_ROUTER_URL: "http://127.0.0.1:3002",
      NEXT_PUBLIC_ROUTER_URL: "http://planted.example",
    });

    expect(JSON.stringify(settings)).not.toContain("planted");
  });
});
