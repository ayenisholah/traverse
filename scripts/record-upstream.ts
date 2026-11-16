import { readFileSync } from "node:fs";
import { scrubPersonalData } from "@traverse/repo-checks";
import { minVersion } from "semver";

/**
 * Prints real public responses as JSON, for tests to replay. Personal fields go before anything is
 * printed, and long version lists are cut to what the tests read. Run it through a redirect:
 *
 *   node scripts/record-upstream.ts npm > subgraphs/packages/test/fixtures/recordings.json
 *   GITHUB_TOKEN=$(gh auth token) node scripts/record-upstream.ts github \
 *     > subgraphs/repositories/test/fixtures/recordings.json
 *   node scripts/record-upstream.ts osv > subgraphs/advisories/test/fixtures/recordings.json
 */
const get = async (url: string, accept = "application/json"): Promise<unknown> => {
  const response = await fetch(url, { headers: { accept, "user-agent": "traverse" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
};

const trimVersions = (document: { versions: Record<string, unknown> }) => ({
  ...document,
  versions: Object.fromEntries(Object.keys(document.versions).map((version) => [version, {}])),
});

const recordPackage = async (name: string): Promise<[string, unknown][]> => {
  const key = name.replaceAll("/", "__");
  const registry = `https://registry.npmjs.org/${name.replaceAll("/", "%2f")}`;
  const abbreviated = await get(registry, "application/vnd.npm.install-v1+json");
  return [
    [`${key}.latest`, await get(`${registry}/latest`)],
    [`${key}.versions`, trimVersions(abbreviated as never)],
    [`${key}.downloads`, await get(`https://api.npmjs.org/downloads/point/last-week/${name}`)],
  ];
};

// The package.json check is tested on these manifests, so every dependency in them is recorded,
// at the version the check asks about: the lowest each range allows. An unrecorded OSV query
// would replay as no advisories, and the test would pass for the wrong reason.
const MANIFESTS = [
  "apps/web/test/fixtures/manifest-subgraph-kit.json",
  "apps/web/test/fixtures/manifest-with-advisories.json",
];

const manifestDependencies = (): [string, string][] =>
  MANIFESTS.flatMap((file) =>
    Object.entries(
      (JSON.parse(readFileSync(file, "utf8")) as { dependencies: Record<string, string> })
        .dependencies,
    ),
  );

const FULL = ["ms", "express", "@types/ms"];

// The check reads only each dependency's latest document, and some version lists run to
// thousands of canary builds, so only that is recorded for them.
const recordLatest = async (name: string): Promise<[string, unknown]> => [
  `${name.replaceAll("/", "__")}.latest`,
  await get(`https://registry.npmjs.org/${name.replaceAll("/", "%2f")}/latest`),
];

const recordNpm = async (): Promise<[string, unknown][]> => {
  const others = new Set(manifestDependencies().map(([name]) => name));
  for (const name of FULL) others.delete(name);
  return [
    ...(await Promise.all(FULL.map(recordPackage))).flat(),
    ...(await Promise.all([...others].map(recordLatest))),
  ];
};

const GITHUB_QUERY = `query Repository($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    isPrivate
    stargazerCount
    owner { login }
    latestRelease { tagName }
  }
}`;

const isDeliberateMiss = (name: string, body: { errors?: { type?: string }[] }): boolean =>
  name === "nothing" && body.errors?.[0]?.type === "NOT_FOUND";

const recordRepository = async (owner: string, name: string): Promise<[string, unknown]> => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "user-agent": "traverse" },
    body: JSON.stringify({ query: GITHUB_QUERY, variables: { owner, name } }),
  });
  const body = (await response.json()) as { errors?: { type?: string }[] };
  // A failure must not overwrite good recordings through the redirect.
  if (!response.ok || (body.errors && !isDeliberateMiss(name, body))) {
    throw new Error(`GitHub answered ${response.status} for ${owner}/${name}`);
  }
  return [`${owner}__${name}`, body];
};

const recordGithub = (): Promise<[string, unknown][]> =>
  Promise.all([
    recordRepository("expressjs", "express"),
    recordRepository("vercel", "ms"),
    recordRepository("no-such-owner-traverse", "nothing"),
  ]);

interface OsvRecord {
  details?: string;
  references?: unknown;
}

const trimRecord = ({ details: _details, references: _references, ...record }: OsvRecord) => record;

const recordQuery = async (key: string, body: object): Promise<[string, unknown]> => {
  const response = await fetch("https://api.osv.dev/v1/query", {
    method: "POST",
    headers: { "user-agent": "traverse" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`OSV answered ${response.status} for ${key}`);
  const { vulns = [], next_page_token: nextPage } = (await response.json()) as {
    vulns?: OsvRecord[];
    next_page_token?: string;
  };
  if (nextPage !== undefined) throw new Error(`${key} has more pages than this records`);
  return [key, { vulns: vulns.map(trimRecord) }];
};

const recordOsv = async (): Promise<[string, unknown][]> => [
  await recordQuery("lodash@4.17.20", {
    package: { name: "lodash", ecosystem: "npm" },
    version: "4.17.20",
  }),
  await recordQuery("express", { package: { name: "express", ecosystem: "npm" } }),
  ...(await Promise.all(
    manifestDependencies()
      .map(([name, range]) => [name, String(minVersion(range))] as const)
      .filter(([name, version]) => !(name === "lodash" && version === "4.17.20"))
      .map(([name, version]) =>
        recordQuery(`${name}@${version}`, { package: { name, ecosystem: "npm" }, version }),
      ),
  )),
  [
    "GHSA-29mw-wpgm-hmr9",
    trimRecord((await get("https://api.osv.dev/v1/vulns/GHSA-29mw-wpgm-hmr9")) as OsvRecord),
  ],
];

const sources: Record<string, () => Promise<[string, unknown][]>> = {
  npm: recordNpm,
  github: recordGithub,
  osv: recordOsv,
};

const source = sources[String(process.argv[2])];
if (source === undefined) throw new Error(`Choose a source: ${Object.keys(sources).join(", ")}`);

const recordings = Object.fromEntries(await source());
process.stdout.write(`${JSON.stringify(scrubPersonalData(recordings), null, 2)}\n`);
