import { cachePolicy, isPackageName, isVersion, type Upstream } from "@traverse/subgraph-kit";
import { z } from "zod";
import { normalizeRepositoryUrl } from "./repository-url.ts";

export interface PackageData {
  name: string;
  latestVersion: string;
  license: string | null;
  repositoryUrl: string | null;
  dependencies: { name: string; range: string }[];
}

export interface NpmClient {
  latest: (name: string) => Promise<PackageData | null>;
  versions: (name: string) => Promise<string[] | null>;
  weeklyDownloads: (name: string) => Promise<number | null>;
}

interface NpmOptions {
  registry: Upstream;
  downloads: Upstream;
  registryUrl: string;
  downloadsUrl: string;
}

export const NPM_REGISTRY_URL = "https://registry.npmjs.org";
export const NPM_DOWNLOADS_URL = "https://api.npmjs.org";

const HOUR = 3600;
const DAY = 24 * HOUR;
const registryPolicy = cachePolicy({ fresh: HOUR, stale: DAY, missing: 10 * 60 });
const downloadsPolicy = cachePolicy({ fresh: 6 * HOUR, stale: 2 * DAY, missing: 10 * 60 });

// npm lets authors write almost anything in these fields. Each is held to the format it should
// have, because a list of what to refuse can't keep up with what an address can look like (GR-16).
const LICENSE = /^[a-z0-9.+() -]+$/i;
const RANGE = /^[a-z0-9.*^~<>=| -]+$/i;

const MAX_TEXT_LENGTH = 256;
const MAX_INT = 2_147_483_647;

// The version document is npm's largest, at 8.8 MB for `typescript`, and it's slow to arrive.
const VERSIONS_TIMEOUT_MS = 15_000;

const matching = (pattern: RegExp, text: string | undefined): string | null =>
  text !== undefined && text.length <= MAX_TEXT_LENGTH && pattern.test(text) ? text : null;

const readDependencies = (dependencies: Record<string, string>): PackageData["dependencies"] =>
  Object.entries(dependencies)
    .filter(([name]) => isPackageName(name))
    .map(([name, range]) => ({ name, range: matching(RANGE, range) ?? "unknown" }));

/**
 * These schemas clean as they parse, so what leaves `fetchJson` is already safe to cache. Only what
 * they name survives, which drops `maintainers`, `author` and `contributors`.
 */
export const latestSchema = z
  .object({
    version: z.string().refine(isVersion),
    license: z
      .union([z.string(), z.object({ type: z.string() }).transform(({ type }) => type)])
      .optional()
      .catch(undefined),
    repository: z
      .union([z.string(), z.object({ url: z.string() }).transform(({ url }) => url)])
      .optional()
      .catch(undefined),
    dependencies: z.record(z.string(), z.string()).default({}).catch({}),
  })
  .transform(({ version, license, repository, dependencies }) => ({
    latestVersion: version,
    license: matching(LICENSE, license),
    repositoryUrl: normalizeRepositoryUrl(repository),
    dependencies: readDependencies(dependencies),
  }));

export const versionsSchema = z
  .object({ versions: z.record(z.string(), z.unknown()) })
  .transform(({ versions }) => Object.keys(versions).filter(isVersion));

export const downloadsSchema = z
  .object({ downloads: z.number().int().min(0).max(MAX_INT).nullable().catch(null) })
  .transform(({ downloads }) => downloads);

// What the cache may hold, checked again on the way back out, with the same rules as on the way in.
const latestStored = z.object({
  latestVersion: z.string().refine(isVersion),
  license: z.string().max(MAX_TEXT_LENGTH).regex(LICENSE).nullable(),
  repositoryUrl: z
    .string()
    .refine((url) => normalizeRepositoryUrl(url) === url)
    .nullable(),
  dependencies: z.array(
    z.object({
      name: z.string().refine(isPackageName),
      range: z.string().refine((range) => range === "unknown" || matching(RANGE, range) !== null),
    }),
  ),
});
const versionsStored = z.array(z.string().refine(isVersion));
const downloadsStored = z.number().int().min(0).max(MAX_INT).nullable();

export const createNpmClient = ({
  registry,
  downloads,
  registryUrl,
  downloadsUrl,
}: NpmOptions): NpmClient => {
  const registryPath = (name: string): string => `${registryUrl}/${name.replaceAll("/", "%2f")}`;

  return {
    latest: async (name) => {
      if (!isPackageName(name)) return null;
      const document = await registry.call({
        key: `latest:${name}`,
        policy: registryPolicy,
        stored: latestStored,
        request: { url: `${registryPath(name)}/latest`, schema: latestSchema },
      });
      return document && { name, ...document };
    },
    versions: (name) => {
      if (!isPackageName(name)) return Promise.resolve(null);
      return registry.call({
        key: `versions:${name}`,
        policy: registryPolicy,
        stored: versionsStored,
        request: {
          url: registryPath(name),
          schema: versionsSchema,
          headers: { accept: "application/vnd.npm.install-v1+json" },
          timeoutMs: VERSIONS_TIMEOUT_MS,
        },
      });
    },
    weeklyDownloads: async (name) => {
      if (!isPackageName(name)) return null;
      const count = await downloads.call({
        key: name,
        policy: downloadsPolicy,
        stored: downloadsStored,
        request: {
          url: `${downloadsUrl}/downloads/point/last-week/${name}`,
          schema: downloadsSchema,
        },
      });
      return count ?? null;
    },
  };
};
