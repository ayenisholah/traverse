import { describe, expect, it, vi } from "vitest";
import { createExplain, toExplainRequest } from "../src/assistant/explain-request.ts";

describe("toExplainRequest", () => {
  it("[FR-AI-1] sends a broken composition's errors, and which side failed", () => {
    expect(
      toExplainRequest({ success: false, failed: "proposed", errors: ["Field A.b clashes."] }),
    ).toEqual({
      kind: "composition",
      failed: "proposed",
      errors: ["Field A.b clashes."],
    });
  });

  it("[FR-AI-1] sends an impact's changes, operations and screens, and only subgraph names", () => {
    const request = toExplainRequest({
      success: true,
      changes: [
        { coordinate: "A.b", kind: "removed", subgraphs: [{ name: "one", owner: "test-team" }] },
      ],
      operations: [{ name: "Q", fields: ["A.b"], errors: ["Cannot query field b."] }],
      screens: [{ name: "Home", operations: ["Q"] }],
    });

    expect(request).toEqual({
      kind: "impact",
      changes: [{ coordinate: "A.b", kind: "removed", subgraphs: ["one"] }],
      operations: [{ name: "Q", fields: ["A.b"], errors: ["Cannot query field b."] }],
      screens: [{ name: "Home", operations: ["Q"] }],
    });
  });

  it("[FR-AI-1] has nothing to explain about a clean result", () => {
    expect(toExplainRequest({ success: true, changes: [], operations: [], screens: [] })).toBe(
      undefined,
    );
  });

  it("[GR-15] cuts a long error list to what the server will read", () => {
    // Non-ASCII, so the request is counted in bytes, as the server's cap is.
    const errors = Array.from({ length: 30 }, (_, i) => `${String(i)} ${"é".repeat(1_900)}`);
    const request = toExplainRequest({ success: false, failed: "current", errors });

    expect(request?.kind === "composition" && request.errors.length).toBeLessThan(30);
    expect(new TextEncoder().encode(JSON.stringify(request)).length).toBeLessThan(30_000);
  });

  it("[FR-AI-1] has nothing to send about a failure with no errors", () => {
    expect(toExplainRequest({ success: false, failed: "current", errors: [] })).toBeUndefined();
  });
});

describe("createExplain", () => {
  it("[FR-AI-4] says a request the server wouldn't read is too large, without sending it", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const operations = Array.from({ length: 50 }, (_, i) => ({
      name: `Q${String(i)}`,
      fields: [],
      errors: ["é".repeat(1_000)],
    }));

    expect(
      await createExplain(fetch)({ kind: "impact", changes: [], operations, screens: [] }),
    ).toEqual({ kind: "too-large" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("[FR-AI-4] reads a call that fails as unavailable", async () => {
    const explain = createExplain(vi.fn<typeof fetch>(() => Promise.reject(new Error("offline"))));

    expect(await explain({ kind: "composition", failed: "current", errors: ["x"] })).toEqual({
      kind: "unavailable",
    });
  });
});
