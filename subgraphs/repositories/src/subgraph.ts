import { readFileSync } from "node:fs";
import {
  createSubgraph,
  isSafeEndpoint,
  type Subgraph,
  type SubgraphDependencies,
} from "@traverse/subgraph-kit";
import { z } from "zod";
import { createGithubClient, GITHUB_GRAPHQL_URL } from "./github.ts";

const typeDefs = readFileSync(new URL("../schema.graphqls", import.meta.url), "utf8");

const environmentSchema = z.object({
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_GRAPHQL_URL: z
    .url({ abort: true })
    // The token goes wherever this points.
    .refine(
      (url) => isSafeEndpoint(url, GITHUB_GRAPHQL_URL),
      "must be GitHub's GraphQL endpoint, or a local service",
    )
    .default(GITHUB_GRAPHQL_URL),
});

export const createRepositoriesSubgraph = ({
  env = process.env,
  ...dependencies
}: SubgraphDependencies = {}): Subgraph => {
  const { GITHUB_TOKEN: token, GITHUB_GRAPHQL_URL: graphqlUrl } = environmentSchema.parse(env);

  return createSubgraph(
    {
      name: "repositories",
      typeDefs,
      resolvers: ({ upstream }) => {
        const github = createGithubClient({ upstream: upstream("GitHub"), graphqlUrl, token });
        return {
          Repository: {
            __resolveReference: ({ url }: { url?: unknown }) => github.repository(url),
          },
          Package: {
            repository: ({ repositoryUrl }: { repositoryUrl?: unknown }) =>
              github.repository(repositoryUrl),
          },
        };
      },
    },
    { ...dependencies, env },
  );
};
