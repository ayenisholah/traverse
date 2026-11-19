import { invalidInput } from "@traverse/subgraph-kit";
import { z } from "zod";

// What one user may keep. Each is far above a real workspace, and keeps a save well under the
// router's 1 MB body limit and the web server's own cap.
export const MAX_WORKSPACES = 50;
export const MAX_NAME_LENGTH = 100;
export const MAX_DRAFTS = 20;
export const MAX_TOTAL_SDL_LENGTH = 150_000;
export const MAX_OPERATIONS_LENGTH = 50_000;
export const MAX_SCREEN_MAP_LENGTH = 10_000;

const SUBGRAPH_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const saveSchema = z.object({
  id: z.string().regex(UUID).nullish(),
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  drafts: z
    .array(z.object({ subgraph: z.string().regex(SUBGRAPH_NAME), sdl: z.string() }))
    .max(MAX_DRAFTS)
    .refine((drafts) => new Set(drafts.map(({ subgraph }) => subgraph)).size === drafts.length)
    .refine(
      (drafts) => drafts.reduce((total, { sdl }) => total + sdl.length, 0) <= MAX_TOTAL_SDL_LENGTH,
    ),
  operations: z.string().max(MAX_OPERATIONS_LENGTH),
  screenMap: z.string().max(MAX_SCREEN_MAP_LENGTH).nullish(),
});

export interface SaveInput {
  id: string | undefined;
  name: string;
  drafts: { subgraph: string; sdl: string }[];
  operations: string;
  screenMap: string | null;
}

/** Checks a save against the limits. The message names the rule, never the input (GR-4). */
export const parseSave = (args: unknown): SaveInput => {
  const parsed = saveSchema.safeParse(args);
  if (!parsed.success) {
    throw invalidInput(
      `A workspace has a name of 1 to ${String(MAX_NAME_LENGTH)} characters, at most ${String(MAX_DRAFTS)} drafts with different subgraph names and ${String(MAX_TOTAL_SDL_LENGTH)} characters of SDL in all, and operations and a screen map within their limits.`,
    );
  }
  const { id, screenMap, ...rest } = parsed.data;
  return { ...rest, id: id ?? undefined, screenMap: screenMap ?? null };
};

/** An ID that can't be a workspace's reads as no workspace, rather than reaching the database. */
export const isWorkspaceId = (id: string): boolean => UUID.test(id);
