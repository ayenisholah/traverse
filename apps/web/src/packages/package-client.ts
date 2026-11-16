import { createApiClient } from "../api-client.ts";
import type { ManifestAnswer, PackageAnswer } from "./types.ts";

export type LoadPackage = (name: string) => Promise<PackageAnswer>;
export type CheckManifest = (manifest: string) => Promise<ManifestAnswer | { kind: "unavailable" }>;

export const createLoadPackage = (fetch?: typeof globalThis.fetch): LoadPackage => {
  const client = createApiClient(fetch);
  return (name) =>
    client.packagePage.query({ name }).catch((): PackageAnswer => ({ kind: "unavailable" }));
};

export const createCheckManifest = (fetch?: typeof globalThis.fetch): CheckManifest => {
  const client = createApiClient(fetch);
  return (manifest) =>
    client.checkManifest.mutate({ manifest }).catch(() => ({ kind: "unavailable" }) as const);
};
