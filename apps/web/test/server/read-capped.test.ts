import { describe, expect, it } from "vitest";
import { readCapped } from "../../src/server/read-capped.ts";

const streamOf = (...pieces: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (const piece of pieces) controller.enqueue(piece);
      controller.close();
    },
  });

describe("readCapped", () => {
  it("reads a body that arrives in pieces, even when a piece splits a character", async () => {
    const bytes = new TextEncoder().encode("café");
    const split = bytes.indexOf(0xc3) + 1;

    expect(await readCapped(streamOf(bytes.slice(0, split), bytes.slice(split)), 100)).toBe("café");
  });

  it("reads no body as empty text", async () => {
    expect(await readCapped(null, 100)).toBe("");
  });

  it("reads a body of exactly the cap", async () => {
    expect(await readCapped(streamOf(new Uint8Array(10).fill(97)), 10)).toBe("a".repeat(10));
  });

  it("stops, and returns nothing, once a body passes the cap", async () => {
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        controller.enqueue(new Uint8Array(1000));
      },
      cancel: () => {
        cancelled = true;
      },
    });

    expect(await readCapped(endless, 5000)).toBeUndefined();
    expect(cancelled).toBe(true);
  });
});
