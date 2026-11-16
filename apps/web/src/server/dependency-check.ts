import { z } from "zod";
import { DependencyOperation, type DependencyQuery } from "../generated/operations.ts";
import type { DependencyResult, ManifestAnswer } from "../packages/types.ts";
import { advisoriesWithFixesSchema } from "./answer-schemas.ts";
import type { ManifestEntry } from "./manifest.ts";
import type { RouterClient } from "./router-client.ts";

// One request at a time per slot, so a long package.json doesn't arrive at the sources at once.
const CONCURRENCY = 4;
// However long the sources take, a check answers within this. What hasn't started by then is
// reported as not checked, never as clean.
const DEADLINE_MS = 30_000;

// Exactly what the operation asks for. The `satisfies` fails the build if they drift.
const dependencyData = z.strictObject({
  package: z
    .strictObject({
      name: z.string(),
      latestVersion: z.string(),
      license: z.string().nullable(),
      advisories: advisoriesWithFixesSchema,
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
  // A source failing also nulls the package, with the answer marked incomplete. That means
  // "couldn't tell", never "no such package" (FR-SG-6).
  if (found === null) {
    return { name, range, version, status: result.incomplete ? "unavailable" : "not-found" };
  }
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

const notStarted = (entry: ManifestEntry): DependencyResult =>
  "skip" in entry
    ? { name: entry.name, range: entry.range, status: "skipped", reason: entry.skip }
    : { name: entry.name, range: entry.range, version: entry.version, status: "unavailable" };

interface Limits {
  /** The browser's request. Once it's gone, nothing more is asked of the sources. */
  signal?: AbortSignal;
  deadlineMs?: number;
  now?: () => number;
}

/** Checks each dependency through the public router's persisted operation, a few at a time. */
export const checkDependencies = async (
  router: RouterClient,
  entries: ManifestEntry[],
  leftOut: number,
  { signal, deadlineMs = DEADLINE_MS, now = Date.now }: Limits = {},
): Promise<ManifestAnswer> => {
  const stopAt = now() + deadlineMs;
  const results: DependencyResult[] = new Array<DependencyResult>(entries.length);
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const index = next;
      next += 1;
      const entry = entries[index] as ManifestEntry;
      const stopped = signal?.aborted === true || now() >= stopAt;
      results[index] = stopped ? notStarted(entry) : await checkOne(router, entry);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return { kind: "checked", dependencies: results, leftOut };
};
