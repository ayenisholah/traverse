import { readFileSync } from "node:fs";
import {
  createSubgraph,
  isSafeEndpoint,
  type Subgraph,
  type SubgraphDependencies,
} from "@traverse/subgraph-kit";
import { z } from "zod";
import { createOsvClient, OSV_URL, SOURCE } from "./osv.ts";

const typeDefs = readFileSync(new URL("../schema.graphqls", import.meta.url), "utf8");

// A wrong address that answers `{}` would make every package look safe.
const environmentSchema = z.object({
  OSV_URL: z
    .url({ abort: true })
    .refine((url) => isSafeEndpoint(url, OSV_URL), "must be OSV's address, or a local service")
    .default(OSV_URL),
});

export const createAdvisoriesSubgraph = ({
  env = process.env,
  ...dependencies
}: SubgraphDependencies = {}): Subgraph => {
  const { OSV_URL: baseUrl } = environmentSchema.parse(env);

  return createSubgraph(
    {
      name: "advisories",
      typeDefs,
      resolvers: ({ upstream }) => {
        const osv = createOsvClient({ upstream: upstream(SOURCE), baseUrl });
        return {
          Advisory: {
            __resolveReference: ({ id }: { id?: unknown }) => osv.advisory(id),
          },
          Package: {
            advisories: ({ name }: { name?: unknown }, { version }: { version?: unknown }) =>
              osv.advisories(name, version),
          },
        };
      },
    },
    { ...dependencies, env },
  );
};
