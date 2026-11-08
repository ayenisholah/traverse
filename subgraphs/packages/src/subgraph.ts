import { readFileSync } from "node:fs";
import {
  createSubgraph,
  isSafeEndpoint,
  type Subgraph,
  type SubgraphDependencies,
} from "@traverse/subgraph-kit";
import { z } from "zod";
import { createNpmClient, NPM_DOWNLOADS_URL, NPM_REGISTRY_URL, type PackageData } from "./npm.ts";

const typeDefs = readFileSync(new URL("../schema.graphqls", import.meta.url), "utf8");

const endpoint = (official: string) =>
  z
    .url({ abort: true })
    .refine((url) => isSafeEndpoint(url, official), "must be npm's address, or a local service")
    .default(official);

const environmentSchema = z.object({
  NPM_REGISTRY_URL: endpoint(NPM_REGISTRY_URL),
  NPM_DOWNLOADS_URL: endpoint(NPM_DOWNLOADS_URL),
});

export const createPackagesSubgraph = ({
  env = process.env,
  ...dependencies
}: SubgraphDependencies = {}): Subgraph => {
  const { NPM_REGISTRY_URL: registryUrl, NPM_DOWNLOADS_URL: downloadsUrl } =
    environmentSchema.parse(env);

  return createSubgraph(
    {
      name: "packages",
      typeDefs,
      resolvers: ({ upstream }) => {
        const npm = createNpmClient({
          registry: upstream("npm"),
          downloads: upstream("npm downloads"),
          registryUrl,
          downloadsUrl,
        });
        return {
          Query: {
            package: (_: unknown, { name }: { name: string }) => npm.latest(name),
          },
          Package: {
            __resolveReference: ({ name }: Pick<PackageData, "name">) => npm.latest(name),
            versions: ({ name }: PackageData) => npm.versions(name),
            weeklyDownloads: ({ name }: PackageData) => npm.weeklyDownloads(name),
          },
        };
      },
    },
    { ...dependencies, env },
  );
};
