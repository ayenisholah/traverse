import { describe, expect, it } from "vitest";
import {
  isWorkspaceId,
  MAX_DRAFTS,
  MAX_NAME_LENGTH,
  MAX_OPERATIONS_LENGTH,
  MAX_SCREEN_MAP_LENGTH,
  MAX_TOTAL_SDL_LENGTH,
  parseSave,
} from "../src/limits.ts";

const ID = "0b0e5a7c-3d0e-4c4f-9a2e-7f1c2d3e4f50";
const valid = {
  name: "Checkout",
  drafts: [{ subgraph: "packages", sdl: "type Query { a: String }" }],
  operations: "query A { a }",
  screenMap: "Checkout: A",
};

describe("parseSave", () => {
  it("[FR-WB-11] takes a workspace within the limits, trimming its name", () => {
    expect(parseSave({ ...valid, name: "  Checkout  " })).toEqual({
      ...valid,
      id: undefined,
      screenMap: "Checkout: A",
    });
    expect(parseSave({ ...valid, id: ID, screenMap: null }).id).toBe(ID);
    expect(parseSave({ ...valid, screenMap: undefined }).screenMap).toBeNull();
  });

  it.each([
    ["an empty name", { name: "   " }],
    ["a name too long", { name: "x".repeat(MAX_NAME_LENGTH + 1) }],
    ["an ID that isn't one", { id: "1 OR 1=1" }],
    [
      "too many drafts",
      {
        drafts: Array.from({ length: MAX_DRAFTS + 1 }, (_, i) => ({
          subgraph: `s${String(i)}`,
          sdl: "",
        })),
      },
    ],
    [
      "two drafts of one subgraph",
      {
        drafts: [
          { subgraph: "a", sdl: "" },
          { subgraph: "a", sdl: "" },
        ],
      },
    ],
    ["a subgraph name that isn't one", { drafts: [{ subgraph: "../etc", sdl: "" }] }],
    [
      "too much SDL in all",
      {
        drafts: [
          { subgraph: "a", sdl: "x".repeat(MAX_TOTAL_SDL_LENGTH) },
          { subgraph: "b", sdl: "x" },
        ],
      },
    ],
    ["operations too long", { operations: "x".repeat(MAX_OPERATIONS_LENGTH + 1) }],
    ["a screen map too long", { screenMap: "x".repeat(MAX_SCREEN_MAP_LENGTH + 1) }],
  ])("[FR-WB-11] refuses %s, and never repeats it", (_, change) => {
    const parse = () => parseSave({ ...valid, name: "secret-name", ...change });

    expect(parse).toThrow(/A workspace has a name of 1 to 100 characters/);
    expect(parse).not.toThrow(/secret-name|OR 1=1|etc/);
  });
});

describe("isWorkspaceId", () => {
  it("[FR-SG-1] knows a workspace ID from anything else", () => {
    expect(isWorkspaceId(ID)).toBe(true);
    expect(isWorkspaceId("abc")).toBe(false);
    expect(isWorkspaceId(ID.toUpperCase())).toBe(false);
  });
});
