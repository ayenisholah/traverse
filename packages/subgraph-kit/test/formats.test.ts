import { describe, expect, it } from "vitest";
import { isSafeEndpoint } from "../src/index.ts";

describe("isSafeEndpoint", () => {
  const official = "https://api.example.com";

  it.each([official, "http://127.0.0.1:9", "http://replay/graphql"])(
    "[FR-SG-7] accepts %s",
    (url) => {
      expect(isSafeEndpoint(url, official)).toBe(true);
    },
  );

  it.each([
    "https://other.example.com",
    "http://api.example.com",
    "http://169.254.169.254",
    "https://replay/graphql",
    "ftp://x",
  ])("[FR-SG-7] refuses %s", (url) => {
    expect(isSafeEndpoint(url, official)).toBe(false);
  });
});
