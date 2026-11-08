import { createDirectUpstream, expectLive, type UpstreamFetch } from "@traverse/subgraph-kit";
import { createGithubClient, GITHUB_GRAPHQL_URL } from "./github.ts";

/** Runs the real client against GitHub, so a change in its answers shows up before users see it. */
export const checkGithub = (fetch: UpstreamFetch, token: string): Promise<string[]> => {
  const github = createGithubClient({
    upstream: createDirectUpstream("GitHub", fetch),
    graphqlUrl: GITHUB_GRAPHQL_URL,
    token,
  });
  return expectLive(
    "GitHub repository",
    () => github.repository("https://github.com/expressjs/express"),
    (found) => found?.owner === "expressjs" && found.stars > 0,
  );
};
