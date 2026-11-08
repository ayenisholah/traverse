import { createDirectUpstream, expectLive, type UpstreamFetch } from "@traverse/subgraph-kit";
import { createNpmClient, NPM_DOWNLOADS_URL, NPM_REGISTRY_URL } from "./npm.ts";

/** Runs the real client against npm, so a change in npm's answers shows up before users see it. */
export const checkNpm = async (fetch: UpstreamFetch): Promise<string[]> => {
  const npm = createNpmClient({
    registry: createDirectUpstream("npm", fetch),
    downloads: createDirectUpstream("npm downloads", fetch),
    registryUrl: NPM_REGISTRY_URL,
    downloadsUrl: NPM_DOWNLOADS_URL,
  });
  const results = await Promise.all([
    expectLive(
      "npm latest",
      () => npm.latest("express"),
      (found) => found?.repositoryUrl === "https://github.com/expressjs/express",
    ),
    expectLive(
      "npm versions",
      () => npm.versions("express"),
      (found) => (found?.length ?? 0) > 0,
    ),
    expectLive(
      "npm downloads",
      () => npm.weeklyDownloads("express"),
      (count) => (count ?? 0) > 0,
    ),
  ]);
  return results.flat();
};
