import { cachePolicy, type Upstream } from "@traverse/subgraph-kit";
import { z } from "zod";

interface RepositoryData {
  url: string;
  stars: number;
  latestRelease: string | null;
  owner: string;
}

export interface GithubClient {
  repository: (url: unknown) => Promise<RepositoryData | null>;
}

interface GithubOptions {
  upstream: Upstream;
  graphqlUrl: string;
  token: string;
}

export const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

const policy = cachePolicy({ fresh: 3600, stale: 24 * 3600, missing: 10 * 60 });

const REPOSITORY_URL = /^https:\/\/github\.com\/([a-z0-9][a-z0-9-]{0,38})\/([\w.-]{1,100})$/i;
const LOGIN = /^[a-z0-9][a-z0-9-]{0,38}$/i;

// Version-shaped, so a tag can't be a sentence. Tags holding `@`, such as `next@14.0.0`, read as no
// release, which is the price of never letting anything address-shaped through (GR-13, GR-16).
const TAG = /^(?:[a-z][a-z0-9-]{0,30}[-/])?v?\d[\w.+-]{0,40}$/i;

const MAX_INT = 2_147_483_647;

const QUERY = `query Repository($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    isPrivate
    stargazerCount
    owner { login }
    latestRelease { tagName }
  }
}`;

interface GithubError {
  type?: string | undefined;
  path?: (string | number)[] | undefined;
}

const isRepositoryMissing = ({ type, path }: GithubError): boolean =>
  type === "NOT_FOUND" && path?.length === 1 && path[0] === "repository";

/**
 * GitHub answers 200 even when a request fails, with the reason in `errors`. A repository is only
 * missing when GitHub says so about the repository itself. Everything else is the source failing,
 * and reporting that as an empty result would hide it, and could end up cached.
 */
export const repositorySchema = z
  .object({
    data: z
      .object({
        repository: z
          .object({
            isPrivate: z.boolean(),
            stargazerCount: z.number().int().min(0).max(MAX_INT),
            owner: z.object({ login: z.string().regex(LOGIN) }),
            latestRelease: z.object({ tagName: z.string() }).nullable(),
          })
          .nullable(),
      })
      .nullish(),
    errors: z
      .array(
        z.object({
          type: z.string().optional(),
          path: z.array(z.union([z.string(), z.number()])).optional(),
        }),
      )
      .optional(),
  })
  .refine(({ data, errors = [] }) =>
    data?.repository ? errors.length === 0 : errors.length > 0 && errors.every(isRepositoryMissing),
  )
  .transform(({ data }) => {
    const found = data?.repository;
    // A package can name any repository, so a token that can read private ones must not reveal them.
    if (!found || found.isPrivate) return null;
    const tag = found.latestRelease?.tagName ?? "";
    return {
      stars: found.stargazerCount,
      owner: found.owner.login,
      latestRelease: TAG.test(tag) ? tag : null,
    };
  });

// What the cache may hold, checked again on the way back out.
const repositoryStored = z.object({
  stars: z.number().int().min(0).max(MAX_INT),
  owner: z.string().regex(LOGIN),
  latestRelease: z.string().regex(TAG).nullable(),
});

export const createGithubClient = ({
  upstream,
  graphqlUrl,
  token,
}: GithubOptions): GithubClient => ({
  repository: async (url) => {
    const [, owner, name] = REPOSITORY_URL.exec(typeof url === "string" ? url : "") ?? [];
    if (owner === undefined || name === undefined) return null;
    const document = await upstream.call({
      key: `${owner}/${name}`.toLowerCase(),
      policy,
      stored: repositoryStored,
      request: {
        url: graphqlUrl,
        schema: repositorySchema,
        method: "POST",
        notFoundIsFailure: true,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { owner, name } }),
      },
    });
    return document && { url: url as string, ...document };
  },
});
