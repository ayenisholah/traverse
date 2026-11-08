# Verified facts

**Updated:** 2026-11-06

This file records what Traverse relies on from Cosmo and AWS, and how far each claim can be trusted. Add a fact here before depending on it.

| Status | Meaning |
|---|---|
| `tested` | Observed directly, by running or calling it |
| `documented` | Read in the official documentation for the pinned version or current service |
| `reported` | Stated by a source that hasn't been confirmed; don't rely on it |
| `unknown` | Not established; must not be relied on until tested |

## Pinned versions

The versions below are the only ones whose docs count. Upgrades change this table in the same pull request.

| Tool | Version | Source |
|---|---|---|
| Node.js | 24 | `.nvmrc` |
| Cosmo Router | `0.366.1` | [Release list](https://github.com/wundergraph/cosmo/releases) |
| Cosmo Router image | `ghcr.io/wundergraph/cosmo/router:0.366.1` @ `sha256:1a8bc23db2c33c2028720b85b56fce68b7bf35f1064bac0f8301eb5ca6cae81c` | GHCR manifest, read directly |
| `wgc` | `0.133.6` | npm registry |
| `@wundergraph/composition` | `0.66.2` | npm registry |
| `graphql` | `16.15.0` | `package-lock.json`. Composition needs 16, so don't move to 17 alone. |
| AWS CDK library | `2.275.0` | npm registry |
| Next.js | `16.4.5` | `package-lock.json` |
| React | `19.3.1` | `package-lock.json` |
| Tailwind CSS | `4.3.4` | `package-lock.json` |
| `radix-ui` | `1.8.1` | `package-lock.json` |
| `graphql-yoga` | `6.0.1` | `package-lock.json` |
| `@apollo/subgraph` | `2.15.1` | `package-lock.json` |

## Cosmo

| ID | Fact | Status | Source |
|---|---|---|---|
| C-1 | Cosmo is licensed under Apache-2.0. | `tested` | GitHub repository metadata |
| C-2 | A graph can run locally with `wgc router compose` and no Cosmo account. That command is for local development only. | `documented` | [Local development](https://cosmo-docs.wundergraph.com/tutorial/mastering-local-development-for-graphql-federation.md) |
| C-3 | Without a graph token, the router sends no analytics or tracing to Cosmo. | `documented` | [Local development](https://cosmo-docs.wundergraph.com/tutorial/mastering-local-development-for-graphql-federation.md) |
| C-4 | `DEV_MODE` must not be set in production. | `documented` | [Deployment](https://cosmo-docs.wundergraph.com/router/deployment.md) |
| C-5 | Cosmo recommends 3 instances of 2 CPUs and 1 GB for low to medium traffic. | `documented` | [Deployment](https://cosmo-docs.wundergraph.com/router/deployment.md) |
| C-6 | On SIGTERM the router drains, then shuts down, within `SHUTDOWN_DELAY`. An explicit `DRAIN_PERIOD` plus `GRACE_PERIOD` can't exceed it. | `documented` | [Configuration](https://cosmo-docs.wundergraph.com/router/configuration.md) |
| C-7 | While draining, the router sends `Connection: close` and returns 503 on readiness. | `documented` | [Deployment](https://cosmo-docs.wundergraph.com/router/deployment.md) |
| C-8 | Health paths default to `/health`, `/health/ready` and `/health/live`. | `documented` | [Configuration](https://cosmo-docs.wundergraph.com/router/configuration.md) |
| C-9 | Introspection, playground and query plans are on by default, and CORS defaults to all origins. | `documented` | [Configuration](https://cosmo-docs.wundergraph.com/router/configuration.md) |
| C-10 | `security.block_non_persisted_operations` and `security.complexity_limits` exist. Complexity limits support `measure` and `enforce` modes. | `documented` | [Configuration](https://cosmo-docs.wundergraph.com/router/configuration.md) |
| C-11 | `traffic_shaping.router.max_request_body_size` defaults to 5 MB. | `documented` | [Configuration](https://cosmo-docs.wundergraph.com/router/configuration.md) |
| C-12 | Rate limiting needs Redis 3.2 or newer. | `documented` | [Configuration](https://cosmo-docs.wundergraph.com/router/configuration.md) |
| C-13 | `execution_config.fallback_storage` is off by default, and its provider must differ from the primary provider. | `documented` | [Configuration](https://cosmo-docs.wundergraph.com/router/configuration.md) |
| C-14 | The router polls the CDN every 15 seconds by default. A config change runs old and new graph instances side by side. | `documented` | [Hot reload](https://cosmo-docs.wundergraph.com/router/deployment/config-hot-reload.md) |
| C-15 | A config swap closes WebSocket and SSE subscriptions, and invalidates the planner cache. | `documented` | [Hot reload](https://cosmo-docs.wundergraph.com/router/deployment/config-hot-reload.md) |
| C-16 | With no exporters configured, telemetry goes to Cosmo Cloud. Sending it elsewhere as well means listing Cosmo Cloud as an explicit exporter. | `documented` | [OpenTelemetry](https://cosmo-docs.wundergraph.com/router/open-telemetry.md) |
| C-17 | Prometheus metrics default to `127.0.0.1:8088/metrics`. | `documented` | [Metrics](https://cosmo-docs.wundergraph.com/router/metrics-and-monitoring.md) |
| C-18 | The Developer plan is free, with 10M requests a month, 1 federated graph, 10 subgraphs, 3 users and 7-day retention. | `documented` | [Pricing](https://wundergraph.com/pricing) |
| C-19 | `@wundergraph/composition` 0.66.2 is Apache-2.0. | `tested` | npm registry |
| C-20 | `federateSubgraphs` composes the schema in `SPEC.md`, its `parentDefinitionDataByTypeName` result gives each field's subgraphs, and a planted break fails with an error. Run in Node 24 and in a browser (C-27). | `tested` | Local run on 2026-11-06 |
| C-21 | `X-WG-Include-Query-Plan` and `X-WG-Skip-Loader` are request tracing options. They only take effect on a request signed from Studio, or in dev mode (C-37). | `tested` | Pinned image on 2026-11-06, and `query_plans_enabled` in `config.schema.json` at `router@0.366.1` |
| C-22 | Self-hosting needs no subscription or licence key. | `reported` | [WunderGraph answers](https://wundergraph.com/answers) |
| C-23 | The pricing table excludes persisted operations, rate limiting and multiple OpenTelemetry exporters below Scale, and cache warming below Enterprise. | `documented` | [Pricing](https://wundergraph.com/pricing) |
| C-24 | The operations check uses router traffic, 7 days by default. | `documented` | [Schema checks](https://cosmo-docs.wundergraph.com/studio/schema-checks.md) |
| C-25 | Persisted operations and the execution config can load from S3, with artifacts pushed by your own CI. | `documented` | [Storage providers](https://cosmo-docs.wundergraph.com/router/storage-providers.md) |
| C-26 | `wgc` commands need `COSMO_API_KEY`, and the router uses `GRAPH_API_TOKEN`. | `documented` | [API keys](https://cosmo-docs.wundergraph.com/cli/api-keys.md) |
| C-27 | `packages/graph-core`, bundled by esbuild, composes the 10 Cosmo demo subgraphs in a Web Worker in headless Chrome in under 200 ms, 111 to 166 ms over three runs. The bundle is 958 KB, or 240 KB gzipped, and its results survive `structuredClone`. In the spike, the longest main-thread gap during composition was 6 ms. | `tested` | Local run on 2026-11-06 |
| C-28 | A field's `subgraphNames` includes subgraphs that only declare it `@external`. `externalFieldDataBySubgraphName` marks them with `isDefinedExternal`. | `tested` | `Employee.isAvailable` in the Cosmo demo, 2026-11-06 |
| C-30 | `new Worker(new URL("./compose.worker.ts", import.meta.url), { type: "module" })` works under Next.js 16.4.5 and Turbopack in a static export. Checking the Cosmo demo graph in it caused no main-thread long task, and the composer's 1 MB chunk loads only in the worker. | `tested` | Playwright run on 2026-11-06 |
| C-29 | Composition rejects removing a field while another subgraph still declares it `@external`. | `tested` | `Employee.currentMood` in the Cosmo demo, 2026-11-06 |
| C-31 | `wgc router compose` writes a router config with no `COSMO_API_KEY`. | `tested` | `wgc` 0.133.6 on 2026-11-06 |
| C-32 | `wgc operations push` needs a Cosmo login, and stops with "Organization slug is not set" without one. | `tested` | `wgc` 0.133.6 on 2026-11-06 |
| C-33 | With no graph token, the pinned router serves persisted operations from `storage_providers.file_system`, and `security.block_non_persisted_operations` rejects anything else. So GR-2 needs no paid plan on a self-hosted router, for local files. | `tested` | Pinned image on 2026-11-06 |
| C-34 | The file provider reads `<path>/<object_prefix>/<sha256>.json`, holding `{"version":1,"body":"…"}`, where the hash is the SHA-256 of the body. A client sends `extensions.persistedQuery`. No client name is needed. A hash that doesn't match its body returns 400. | `tested` | Pinned image, and `operationstorage/fs/client.go` at the tag |
| C-35 | The persisted operations manifest supports S3 and the CDN, not the file system. | `documented` | `router/internal/persistedoperation/PO_MANIFEST_S3_GUIDE.md` at the tag |
| C-36 | With JWKS set and `require_authentication: false`, a request with no token succeeds. Expired, wrong-audience, wrongly signed and malformed tokens return 401 and reach no subgraph. `authentication.jwt.on_error` defaults to `reject`. | `tested` | Pinned image on 2026-11-06 |
| C-37 | `engine.debug.always_include_query_plan: true` returns the plan with no dev mode or token, in `extensions.queryPlan`, shaped like `{version, kind, fetch: {kind, subgraphName, subgraphId, fetchId, query}, normalizedQuery}`. `query_plans_enabled: false` overrides it. | `tested` | Pinned image on 2026-11-06 |
| C-38 | The router's HTTP server sets `ReadTimeout` to 60 seconds and no `IdleTimeout`, and Go then uses `ReadTimeout`. No config key changes it. | `documented` | `router/core/http_server.go` at the tag, and Go's `net/http` documentation |
| C-39 | The pinned image holds the `router` binary and no shell, and has no health subcommand, so a container health check can't run in it. | `tested` | Exported image, and `router --help`, on 2026-11-06 |
| C-40 | `headers.all.request` with `op: propagate` and `named: Authorization` forwards the token to subgraphs. | `tested` | Pinned image on 2026-11-06 |
| C-41 | With a graph token, no local config and the CDN unreachable, the router retries and then fails to start. | `tested` | Pinned image on an internal network, 2026-11-06 |
| C-42 | `introspection_enabled` and `playground_enabled` are deprecated in favour of `introspection.enabled` and `playground.enabled`, and both forms exist. | `tested` | Warnings from the pinned image on 2026-11-06 |

## Data sources

| ID | Fact | Status | Source |
|---|---|---|---|
| D-1 | The npm registry and downloads API answer with no key. | `tested` | Live request on 2026-11-05 |
| D-2 | OSV answers version queries with no key. It returned 4 advisories for `lodash` 4.17.20. | `tested` | Live request on 2026-11-05 |
| D-3 | GitHub GraphQL allows 5,000 points an hour for an authenticated user. | `tested` | `rate_limit` API on 2026-11-05 |
| D-4 | The deps.dev `:dependencies` endpoint returned 404, so npm metadata is used instead. | `tested` | Live request on 2026-11-05 |
| D-5 | npm's terms allow replicating registry data through the public APIs. They ban an "unreasonable volume of requests", and say five million in a month isn't reasonable. | `documented` | [npm open source terms](https://docs.npmjs.com/policies/open-source-terms) |
| D-6 | GitHub's terms can suspend API access for excessive requests, ban sharing tokens to exceed rate limits, and ban selling users' personal information. | `documented` | [GitHub terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) |
| D-7 | OSV says its API has no limit, and caps HTTP/1.1 responses at 32 MiB. | `documented` | [OSV FAQ](https://google.github.io/osv.dev/faq/) |
| D-8 | npm's `/{name}/latest` includes `maintainers` with emails. OSV records carry `database_specific.severity`, and `affected[].ranges[].events` with `fixed`. | `tested` | Live requests on 2026-11-06 |
| D-9 | npm's abbreviated version document is 8.8 MB for `typescript`, and took 1.7 to 12.8 seconds here. Scoped names work encoded or plain, and an unknown package returns 404. | `tested` | Live requests on 2026-11-06 |
| D-10 | `repository.url` comes in many forms: `git+https://`, `git+ssh://git@`, `git://`, `github:owner/repo`, and paths such as `/tree/master/packages/x`. | `tested` | 15 real packages on 2026-11-06 |
| D-11 | GitHub GraphQL answers 200 with `errors: [{"type":"NOT_FOUND"}]` and `repository: null` for a missing repository. A bad token returns 401, and no token returns 403 with the caller's IP in the message. A repository query costs 1 point. | `tested` | Live requests on 2026-11-06 |
| D-12 | OSV answers `{}` for a package with no advisories, ignores a malformed version and returns every record, and returns 404 for an unknown ID. Across 309 npm records, every one had a `summary`, of at most 157 characters. 117 had more than one fix, and `affected` often names other packages. A record can carry `withdrawn` and `credits[].contact`, and a query can return `next_page_token`. | `tested` | Live requests on 2026-11-06, and the [OSV schema](https://ossf.github.io/osv-schema/) |

## Web

| ID | Fact | Status | Source |
|---|---|---|---|
| W-1 | With `output: "export"`, `next build` writes static files to `out`. | `tested` | `next build` in `node:24` on 2026-11-06, and `node_modules/next/dist/docs/01-app/02-guides/static-exports.md` |
| W-2 | `next build` refuses a route using `dynamic = "force-dynamic"` under `output: "export"`. | `tested` | Planted route on 2026-11-06 |
| W-3 | `eslint-config-next` 16.4.5 depends on `eslint-plugin-react` and `eslint-plugin-jsx-a11y`, whose peer ranges stop at ESLint 9. | `tested` | npm registry on 2026-11-06 |
| W-5 | `graphql` 16 ships CJS and ESM builds. Under Vite, composition's schema objects fail in our `graphql` calls with "from another module or realm". AST nodes are plain objects and cross safely. The same split makes Yoga mask a deliberate `GraphQLError`, so Vitest's node project aliases `graphql` to the CommonJS build that Node loads. | `tested` | Vitest run on 2026-11-06 |
| W-6 | `@wundergraph/composition` 0.66.2 asks for `@graphql-tools/utils` ^11, which has two high severity advisories (GHSA-7mx3-vvmw-hjmv, GHSA-c4qx-w738-7hr3). An npm override scoped to composition, to ^12.1.0, clears `npm audit`, and composition passes every test and the Chrome run on it. It has to be scoped, because `graphql-tag-pluck` needs ^13. Overrides don't reach packages installed by others. | `tested` | `npm audit` and `npm ls @graphql-tools/utils`, on 2026-11-06 |
| W-7 | The values in `packages/design-tokens` are the Frox scale. They haven't been compared with the file's variables from this repository, because the Figma MCP call limit on the Starter plan was reached. | `reported` | [Frox Figma file](https://www.figma.com/design/jWHhIpI52m6ABnQpcTzZkG/Frox_dashboard_v5?node-id=1169-12005) |
| W-8 | Setting `--color-*: initial` in `@theme` removes Tailwind's default palette: `bg-red-500` emits no CSS. | `tested` | Planted class on 2026-11-06 |
| W-9 | `document.fonts.check` returns true when the font hasn't loaded, so a test must read each face's `status`. | `tested` | Planted missing font on 2026-11-06 |
| W-4 | Under jsdom, axe reports colour contrast as `incomplete`, not as a violation, even for `#eee` on `#fff`. In Chromium through Playwright, the same text fails `color-contrast`. | `tested` | Local run and planted violation on 2026-11-06 |
| W-10 | Node 24 refuses to strip types under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so a TypeScript package can't run once installed from npm. | `tested` | `node:24` on 2026-11-06 |
| W-11 | `gqlPluckFromCodeStringSync` 9.0.9 returns `Source[]`, though its docs say a string. It drops every `${...}`, finds `gql` tags even with no import, `graphql()` calls and `/* GraphQL */` comments, and throws on source it can't parse. `.vue` needs `@vue/compiler-sfc`. | `tested` | `packages/cli/test/extract.test.ts`, 2026-11-06 |
| W-12 | `fs.globSync` in Node 24 expands braces, and `exclude` receives a `Dirent` with `withFileTypes`. | `tested` | `packages/cli/test/source.test.ts`, 2026-11-06 |
| W-13 | Issue comments: `GET` and `POST /repos/{owner}/{repo}/issues/{number}/comments`, with `per_page` up to 100, and `PATCH /repos/{owner}/{repo}/issues/comments/{id}`. The current API version is `2026-03-10`. Comments include `user.type`. | `documented` | [Issue comments](https://docs.github.com/en/rest/issues/comments) |
| W-14 | On `pull_request` from a fork, `GITHUB_TOKEN` is read-only and secrets aren't passed. | `documented` | [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) |
| W-15 | With `pull-requests: write`, `GITHUB_TOKEN` can list, create and update issue comments on a pull request, and the author is `github-actions[bot]`. `git fetch` of a base SHA works in a public repository with `persist-credentials: false`. | `tested` | [Pull request #32](https://github.com/ayenisholah/traverse/pull/32#issuecomment-6683679869), 2026-11-06 |
| W-16 | npm trusted publishing needs `id-token: write`, npm 11.5.1 or later, Node 22.14 or later, a cloud-hosted runner, and a `repository.url` matching the repository. It needs no token, and adds provenance for a public package from a public repository. The trusted publisher is added in the package's settings, so the package must exist first. A new one expires after 2 days without a publish. `npm stage publish` is always allowed, and `npm publish` needs the "Allow npm publish" option. | `documented` | [Trusted publishers](https://docs.npmjs.com/trusted-publishers) |
| W-17 | `node:24` ships npm 11.19.1. | `tested` | `npm --version` on 2026-11-06 |
| W-18 | release-please-action v5 outputs `release_created` for a root component, and `extra-files` entries of type `json` update the field named by `jsonpath`. | `tested` | [Action README](https://github.com/googleapis/release-please-action/blob/v5.0.0/README.md), [customizing](https://github.com/googleapis/release-please/blob/main/docs/customizing.md), and the `0.7.1` release |
| W-19 | `Release-As: x.y.z` in a commit body makes release-please open a pull request for that version. | `documented` | [release-please README](https://github.com/googleapis/release-please/blob/main/README.md) |
| W-20 | `npx @ayenis/traverse@0.7.1` from the registry runs in a clean `node:24` container, exits 0 on the Cosmo demo schemas and 1 on a planted break. `release.yml` published it through the trusted publisher, with SLSA provenance and no runtime dependencies. | `tested` | [Release run](https://github.com/ayenisholah/traverse/actions/runs/42233755838), 2026-11-06 |
| W-21 | `npm publish` in CI warns `No bin file found at dist/bin.js`, because `dist` doesn't exist until `prepack` runs. The published manifest still has `bin`, and the command works. | `tested` | The same run, and the registry manifest of `0.7.1` |
| W-22 | A Pages deployment ID is the commit SHA. Once cancelled, it stays `deployment_cancelled`, and rerunning that run fails within seconds. | `tested` | [Run 42246560098](https://github.com/ayenisholah/traverse/actions/runs/42246560098), attempt 2 |
| W-23 | GitHub Pages serves `/traverse/impact` from `impact.html`, and redirects `/traverse` to `/traverse/` with a 301. The Web Worker, fonts and links work under that path. | `tested` | [Run 42249140309](https://github.com/ayenisholah/traverse/actions/runs/42249140309) |
| W-24 | `buildSubgraphSchema` in `@apollo/subgraph` 2.15.1 takes an array of modules. A single `{ typeDefs, resolvers }` object fails with `doc.definitions is not iterable`. | `tested` | `packages/subgraph-kit`, 2026-11-06 |
| W-25 | `ioredis` 6.0.0 opens a connection with `HELLO 3`, `CLIENT SETINFO` twice and `INFO`, and needs a reply to each before it's ready. A refused `HELLO` is fatal, not a fallback. With `enableOfflineQueue: false`, a command before ready fails at once. `commandTimeout: 500` ends a hung `GET` at about 500 ms. | `tested` | A fake server in `packages/subgraph-kit/test/support/fake-redis.ts`, 2026-11-08 |

## AWS

| ID | Fact | Status | Source |
|---|---|---|---|
| A-1 | A 2 vCPU Fargate task takes 4 GB to 16 GB of memory. | `documented` | [Fargate task definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html) |
| A-2 | On Fargate, `stopTimeout` defaults to 30 seconds, with a maximum of 120. | `documented` | [ContainerDefinition](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html) |
| A-3 | An Application Load Balancer's idle timeout defaults to 60 seconds. AWS recommends a longer idle timeout in the application, or 502 errors can occur. | `documented` | [ALB attributes](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html) |
| A-4 | Service Connect adds a proxy container to each task, which shares the task's resources. It has no extra charge. | `documented` | [Service Connect](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-connect.html) |
| A-5 | An ACM certificate for HTTPS between viewers and CloudFront must be in `us-east-1`. | `documented` | [CloudFront certificates](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html) |
| A-6 | Amazon Managed Grafana isn't offered in eu-north-1. | `documented` | [Managed Grafana regions](https://docs.aws.amazon.com/grafana/latest/userguide/what-is-Amazon-Managed-Service-Grafana.html) |
| A-7 | A Free plan project is assigned one Region, and other Regions need a plan upgrade and advanced features. | `tested` | Console message and API calls on the development account |
| A-8 | Activating advanced features can't be reversed, removes any spend limit and prevents new projects in that organisation. | `documented` | [Activate advanced features](https://docs.aws.amazon.com/accounts/latest/reference/activate-advanced-features.md) |
| A-9 | Upgrading an account plan can't be reversed. | `documented` | [Upgrade your account](https://docs.aws.amazon.com/accounts/latest/reference/upgrade-account.md) |

## Open questions

Each is answered by test before the feature that depends on it ships.

| ID | Question | Needed by | Answered in |
|---|---|---|---|
| U-1 | Does the router's S3 provider use Fargate task-role credentials? The docs only name EC2 and EKS. | FR-GW-3 | M7 |
| U-3 | What does the router do when the CDN goes down while running, and does the S3 fallback cover a new task? At startup with no fallback it fails (C-41). | FR-GW-3 | M10 |
| U-6 | What retention, limits and support does the Cosmo free plan give? | FR-OB-2 | Before the first deploy |
| U-7 | Which account route gives multi-Region access and the needed quotas, and at what cost? | NFR-6 | Before M4 |
| U-13 | Do persisted operations from S3, Redis rate limiting and multiple OpenTelemetry exporters work on a self-hosted router on the free plan? Local files do (C-33). | GR-2, FR-GW-5 | M7, M8 |
| U-15 | What licence covers the OSV data Traverse would serve? The terms of use and rate limits are in D-5 to D-7, and the FAQ names no data licence. | FR-SG-6 | Before launch |
| U-17 | Can a third-party app read the Platform API? The docs describe it as used by the CLI and Studio. | FR-WB-1 | M3 |
| U-19 | Which current Claude model does Bedrock offer from the chosen Region, and at what cost? | FR-AI-1 | Before M5 |
| U-21 | Do the values in `packages/design-tokens` match the Figma file's variables exactly? See W-7. | FR-WB-13 | When the Figma call limit resets |
| U-22 | Do Cognito access tokens carry `aud`? `packages/subgraph-kit` requires `aud`, `iss`, `exp` and `sub`, and a token shaped with `client_id` instead verifies as no user. Using ID tokens instead may put emails in reach of the router. | GR-3, FR-WB-10 | Before M4 |

## Answered questions

| ID | Question | Needed by | Answer | Source |
|---|---|---|---|---|
| U-2 | Does the router image contain anything that can run a container health check? | FR-GW-7 | No. It has no shell or health subcommand, so health comes from the load balancer's target group. | C-39 |
| U-4 | Is the router's HTTP idle timeout longer than the load balancer's? If not, it must change to avoid 502 errors (A-3). | NFR-2 | No. It's 60 seconds, the same as the default, and can't be changed, so the load balancer is set to 50. | C-38 |
| U-5 | How is the `Authorization` header forwarded to subgraphs, and how is it configured? | GR-3 | With a `propagate` rule under `headers.all.request`. | C-40 |
| U-9 | How are generated operations pushed to Cosmo as persisted operations, and which `wgc` command does it? | FR-WB-12 | `wgc operations push`, which needs a Cosmo login. Locally, files in the C-34 format need no account. | C-32, C-34 |
| U-14 | Does `wgc router compose` need `COSMO_API_KEY`? C-2 and C-26 disagree. | FR-GW-2 | No. | C-31 |
| U-16 | What shape is the query plan in `extensions`, and does it need dev mode or a token? The docs don't say. | FR-WB-7 | It needs a signed request, dev mode or `always_include_query_plan`. The sandbox router uses the last, and the shape is in C-37. | C-21, C-37 |
| U-8 | Do `SPEC.md`'s entity definitions compose as written? | FR-SG-5 | Yes. | C-20 |
| U-10 | Does the Frox licence allow derived tokens and components in a public MIT repository? | GR-10 | Partly: the owner confirmed public use. U-18 answers the MIT question. | Owner statement, 2026-11-05, recorded in [ADR 0008](adr/0008-frox-design-system.md) |
| U-11 | Does `@wundergraph/composition` run in a Web Worker, at an acceptable bundle size? | FR-WB-2 | Yes. 240 KB gzipped is acceptable, because it loads in the worker and not on the main thread. | C-27 |
| U-12 | Can field-to-subgraph data be read from composition output? | FR-WB-4 | Yes. | C-20 |
| U-20 | Does `packages/graph-core` run in a Web Worker built by Next.js and Turbopack? | FR-WB-2 | Yes. | C-30 |
| U-18 | Do the Frox terms allow derived tokens in an MIT repository? | GR-10 | Yes: "you can use frox in an MIT license project". The licence text isn't held in this repository. | Owner statement, 2026-11-06, recorded in [ADR 0010](adr/0010-tailwind-radix-frox-scale.md) |
