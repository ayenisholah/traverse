import { rcompare, valid } from "semver";
import { z } from "zod";
import { PackagePageOperation, type PackagePageQuery } from "../generated/operations.ts";
import type { PackageAnswer } from "../packages/types.ts";
import { advisoriesSchema, repositorySchema } from "./answer-schemas.ts";
import type { RouterClient } from "./router-client.ts";

const RECENT_VERSIONS = 20;

// Exactly what the operation asks for. The `satisfies` fails the build if they drift.
const pageData = z.strictObject({
  package: z
    .strictObject({
      name: z.string(),
      latestVersion: z.string(),
      versions: z.array(z.string()).nullable(),
      license: z.string().nullable(),
      weeklyDownloads: z.number().nullable(),
      repositoryUrl: z.string().nullable(),
      dependencies: z.array(z.strictObject({ name: z.string(), range: z.string() })),
      repository: repositorySchema,
      advisories: advisoriesSchema,
    })
    .nullable(),
}) satisfies z.ZodType<PackagePageQuery>;

/** A package's page: its newest versions, dependencies, repository and advisories (FR-WB-8). */
export const loadPackagePage = async (
  router: RouterClient,
  name: string,
): Promise<PackageAnswer> => {
  const result = await router.run(PackagePageOperation, { name });
  if (!result.ok) return { kind: "unavailable" };
  const data = pageData.safeParse(result.data);
  if (!data.success) return { kind: "unavailable" };
  const found = data.data.package;
  if (found === null) return { kind: "not-found" };
  const { versions } = found;
  const sorted = (versions ?? []).filter((version) => valid(version) !== null).sort(rcompare);
  return {
    kind: "found",
    incomplete: result.incomplete,
    package: {
      name: found.name,
      latestVersion: found.latestVersion,
      license: found.license,
      weeklyDownloads: found.weeklyDownloads,
      recentVersions: sorted.slice(0, RECENT_VERSIONS),
      versionCount: versions === null ? null : sorted.length,
      dependencies: found.dependencies,
      repository: found.repository,
      advisories: found.advisories,
    },
  };
};
