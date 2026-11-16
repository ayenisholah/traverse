import { z } from "zod";
import { DependencyOperation, type DependencyQuery } from "../generated/operations.ts";
import type { DependencyResult, ManifestAnswer } from "../packages/types.ts";
import type { ManifestEntry } from "./manifest.ts";
import type { RouterClient } from "./router-client.ts";

// One request at a time per slot, so a long package.json doesn't arrive at the sources at once.
const CONCURRENCY = 4;

const advisory = z.strictObject({
  id: z.string(),
  summary: z.string(),
  severity: z.string().nullable(),
  fixedIn: z.string().nullable(),
});

// Exactly what the operation asks for (GR-16). The `satisfies` fails the build if they drift.
const dependencyData = z.strictObject({
  package: z
    .strictObject({
      name: z.string(),
      latestVersion: z.string(),
      license: z.string().nullable(),
      advisories: z.array(advisory).nullable(),
    })
    .nullable(),
}) satisfies z.ZodType<DependencyQuery>;

const checkOne = async (router: RouterClient, entry: ManifestEntry): Promise<DependencyResult> => {
  const { name, range } = entry;
  if ("skip" in entry) return { name, range, status: "skipped", reason: entry.skip };
  const { version } = entry;
  const result = await router.run(DependencyOperation, { name, version });
  if (!result.ok) return { name, range, version, status: "unavailable" };
  const data = dependencyData.safeParse(result.data);
  if (!data.success) return { name, range, version, status: "unavailable" };
  const found = data.data.package;
  if (found === null) return { name, range, version, status: "not-found" };
  return {
    name,
    range,
    version,
    status: "checked",
    latestVersion: found.latestVersion,
    license: found.license,
    // OSV failing nulls the field, and the router marks the answer incomplete. Either way that
    // means "couldn't tell", never "no advisories".
    advisories: result.incomplete ? null : found.advisories,
  };
};

/** Checks each dependency through the public router's persisted operation, a few at a time. */
export const checkDependencies = async (
  router: RouterClient,
  entries: ManifestEntry[],
  leftOut: number,
): Promise<ManifestAnswer> => {
  const results: DependencyResult[] = new Array<DependencyResult>(entries.length);
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const index = next;
      next += 1;
      results[index] = await checkOne(router, entries[index] as ManifestEntry);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return { kind: "checked", dependencies: results, leftOut };
};
