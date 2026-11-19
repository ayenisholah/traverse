import { describe, expect, it, vi } from "vitest";
import { createWorkspaceApi } from "../src/workspaces/workspace-client.ts";

const ID = "0b0e5a7c-3d0e-4c4f-9a2e-7f1c2d3e4f50";
const summary = { id: ID, name: "Checkout", updatedAt: "2026-11-19T10:00:00.000Z" };

/** Answers as this app's server does: tRPC's JSON, with the fixed error shape from api.ts. */
const server = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => Response.json(body, { status }));
const failing = (code: string, httpStatus: number) =>
  server(httpStatus, { error: { message: "x", code: -32_000, data: { code, httpStatus } } });

describe("createWorkspaceApi", () => {
  it("[FR-WB-11] lists, opens, saves and deletes through this app's own server", async () => {
    const fetch = server(200, { result: { data: [summary] } });
    const api = createWorkspaceApi(fetch);

    expect(await api.list()).toEqual({ ok: true, value: [summary] });
    await api.open(ID);
    await api.save({ name: "Checkout", drafts: [], operations: "", screenMap: null });
    await api.remove(ID);

    const urls = fetch.mock.calls.map(([url]) => (typeof url === "string" ? url : ""));
    expect(urls[0]).toMatch(/^\/api\/trpc\/workspaces/);
    expect(urls[1]).toMatch(/^\/api\/trpc\/workspace\?input=/);
    expect(urls[2]).toBe("/api/trpc/saveWorkspace");
    expect(urls[3]).toBe("/api/trpc/deleteWorkspace");
    // User text travels in a POST body, never in an address (GR-4).
    expect(fetch.mock.calls[2]?.[1]?.method).toBe("POST");
  });

  it.each([
    ["UNAUTHORIZED", 401, "signed-out"],
    ["NOT_FOUND", 404, "not-found"],
    ["PRECONDITION_FAILED", 412, "limit"],
    ["BAD_REQUEST", 400, "invalid"],
    ["SERVICE_UNAVAILABLE", 503, "unavailable"],
  ])("[FR-WB-11] reads %s as %s", async (code, status, failure) => {
    const api = createWorkspaceApi(failing(code, status));

    expect(await api.list()).toEqual({ ok: false, failure });
  });

  it("[FR-WB-11] reads no answer at all as unavailable", async () => {
    const api = createWorkspaceApi(vi.fn<typeof fetch>(() => Promise.reject(new Error("offline"))));

    expect(await api.remove(ID)).toEqual({ ok: false, failure: "unavailable" });
  });
});
