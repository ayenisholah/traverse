import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  DeleteWorkspaceOperation,
  SaveWorkspaceOperation,
  WorkspaceOperation,
  WorkspacesOperation,
  type DeleteWorkspaceMutation,
  type SaveWorkspaceMutation,
  type WorkspaceQuery,
  type WorkspacesQuery,
} from "../generated/operations.ts";
import type { RouterClient, RouterResult } from "./router-client.ts";

// The subgraph holds the real limits. These bound what this server forwards, so a body it reads
// can't be larger than a save the subgraph could take.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const workspaceId = z.object({ id: z.string().regex(UUID) });
export const saveInput = z.object({
  id: z.string().regex(UUID).optional(),
  name: z.string().min(1).max(100),
  drafts: z.array(z.object({ subgraph: z.string().max(64), sdl: z.string().max(150_000) })).max(20),
  operations: z.string().max(50_000),
  screenMap: z.string().max(10_000).nullable(),
});

// Each answer is checked against exactly what its operation asked for (GR-16).
const summary = z.strictObject({ id: z.string(), name: z.string(), updatedAt: z.string() });
const listData = z.strictObject({
  workspaces: z.array(summary),
}) satisfies z.ZodType<WorkspacesQuery>;
const oneData = z.strictObject({
  workspace: z
    .strictObject({
      id: z.string(),
      name: z.string(),
      drafts: z.array(z.strictObject({ subgraph: z.string(), sdl: z.string() })),
      operations: z.string(),
      screenMap: z.string().nullable(),
      updatedAt: z.string(),
    })
    .nullable(),
}) satisfies z.ZodType<WorkspaceQuery>;
const saveData = z.strictObject({
  saveWorkspace: summary,
}) satisfies z.ZodType<SaveWorkspaceMutation>;
const deleteData = z.strictObject({
  deleteWorkspace: z.boolean(),
}) satisfies z.ZodType<DeleteWorkspaceMutation>;

/** The signed-in user's token, or a refusal: these operations are only ever on their own data. */
export const signedInToken = (accessToken: string | undefined): string => {
  if (accessToken === undefined) throw new TRPCError({ code: "UNAUTHORIZED" });
  return accessToken;
};

// Only the codes the workspace subgraph sends are read, never its messages (C-57).
const failure = (result: RouterResult): TRPCError => {
  const codes = result.ok ? [] : (result.codes ?? []);
  if (codes.includes("UNAUTHENTICATED")) return new TRPCError({ code: "UNAUTHORIZED" });
  if (codes.includes("NOT_FOUND")) return new TRPCError({ code: "NOT_FOUND" });
  if (codes.includes("WORKSPACE_LIMIT")) return new TRPCError({ code: "PRECONDITION_FAILED" });
  if (codes.includes("BAD_USER_INPUT")) return new TRPCError({ code: "BAD_REQUEST" });
  return new TRPCError({ code: "SERVICE_UNAVAILABLE" });
};

const answer = <T>(result: RouterResult, schema: z.ZodType<T>): T => {
  const parsed = result.ok && !result.incomplete ? schema.safeParse(result.data) : undefined;
  if (!parsed?.success) throw failure(result);
  return parsed.data;
};

export const listWorkspaces = async (router: RouterClient, token: string) =>
  answer(await router.run(WorkspacesOperation, {}, token), listData).workspaces;

export const getWorkspace = async (router: RouterClient, token: string, id: string) =>
  answer(await router.run(WorkspaceOperation, { id }, token), oneData).workspace;

export const saveWorkspace = async (
  router: RouterClient,
  token: string,
  input: z.infer<typeof saveInput>,
) =>
  answer(
    await router.run(SaveWorkspaceOperation, { ...input, id: input.id ?? null }, token),
    saveData,
  ).saveWorkspace;

export const deleteWorkspace = async (router: RouterClient, token: string, id: string) =>
  answer(await router.run(DeleteWorkspaceOperation, { id }, token), deleteData).deleteWorkspace;
