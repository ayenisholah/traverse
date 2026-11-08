import { createDirectUpstream, expectLive, type UpstreamFetch } from "@traverse/subgraph-kit";
import { createOsvClient, OSV_URL, SOURCE } from "./osv.ts";

/** Runs the real client against OSV, so a change in its answers shows up before users see it. */
export const checkOsv = (fetch: UpstreamFetch): Promise<string[]> => {
  const osv = createOsvClient({ upstream: createDirectUpstream(SOURCE, fetch), baseUrl: OSV_URL });
  return expectLive(
    "OSV advisories",
    () => osv.advisories("lodash", "4.17.20"),
    (found) =>
      found?.some(({ id, fixedIn }) => id === "GHSA-29mw-wpgm-hmr9" && fixedIn === "4.17.21") ===
      true,
  );
};
