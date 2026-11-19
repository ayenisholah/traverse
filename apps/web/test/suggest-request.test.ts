import { describe, expect, it, vi } from "vitest";
import { createSuggest } from "../src/assistant/suggest-request.ts";

const request = {
  subgraph: "family",
  drafts: { family: "type Query { a: Int }" },
  operations: "",
  screens: "",
};

describe("createSuggest", () => {
  it("[FR-AI-4] reads a call that fails as unavailable", async () => {
    const suggest = createSuggest(vi.fn<typeof fetch>(() => Promise.reject(new Error("offline"))));

    expect(await suggest(request)).toEqual({ kind: "unavailable" });
  });

  it("[GR-15] says a request the server wouldn't read is too large, without sending it", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const huge = { ...request, drafts: { family: "é".repeat(130_000) } };

    expect(await createSuggest(fetch)(huge)).toEqual({ kind: "too-large" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
