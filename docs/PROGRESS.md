# Progress

**Updated:** 2026-11-09

Read this first. It says what's done, what's in progress and what's left, so any agent can resume after a session ends unexpectedly. Update it in the same commit as the work.

## Direction

Traverse is built on WunderGraph Cosmo and helps frontend developers explore a federated graph. `SPEC.md` describes the target, and the [roadmap](ROADMAP.md) lists every branch.

## Done

| Date | Work | PR |
|---|---|---|
| 2026-11-09 | FR-SG-10 done: `upstream-check.yml`, run by hand on `main`, passed against live npm, GitHub and OSV, with the default `GITHUB_TOKEN` reading GitHub GraphQL ([run 42534288485](https://github.com/ayenisholah/traverse/actions/runs/42534288485)). The first attempt failed once on npm downloads, which answered normally from a local run and on the re-run. | `docs/upstream-check-proof` |
| 2026-11-09 | `feat/local-router` merged, which closes M2. CodeQL flagged operation text from a file going out in an e2e request, fixed by taking the hash from the generated file's name. gitleaks flagged `wgc`'s schema hashes in `router/config.json`, allowed on one rule with the owner's approval. | #50 |
| 2026-11-08 | `router/`: the three subgraphs composed behind the pinned router, with a hardened public config. Persisted operations only, from local files; cost limits that also cover persisted operations; anonymous reads, with invalid tokens refused. The GR-1 check requires every risky setting written out literally, and a second check holds the deployment's environment to six known variables, after the guardrail review got APQ, MCP and wildcard CORS through environment variables. A Docker e2e suite in `verify` runs the join, GR-2, the limits, the token rules and a GitHub outage on the pinned image. FR-GW-2, FR-GW-4, FR-SG-5, FR-SG-6, GR-1 and GR-2 are done, and M2 is done. | `feat/local-router` |
| 2026-11-08 | README roadmap and status brought up to date: M1 waits on user feedback, M2 is in progress, the three subgraphs are built, and the Action example pins `v0.8.0`. | `docs/readme-roadmap` |
| 2026-11-08 | Released `v0.8.0` to npm with provenance, after approving the release pull request's workflow runs by API. Deleted the stale `signalbox` release and `@types/node` 26 branches. | #44 |
| 2026-11-08 | Forged-entry tests for every check run on cache entries read back, each proven by removing the check. Found by the guardrail review of upstream resilience. | #48 |
| 2026-11-05 | Repository tooling and README | #1, #2 |
| 2026-11-05 | Specification, requirements and project documents | #3 |
| 2026-11-05 | `AGENTS.md` and `CLAUDE.md` | #4 |
| 2026-11-05 | Quality gates, CI, CodeQL, Dependabot and release-please | #5 |
| 2026-11-05 | Repository setting: GitHub Actions can create pull requests | none |
| 2026-11-06 | Progress log and `check:progress` | #12 |
| 2026-11-06 | dependency-cruiser 18 | #7 |
| 2026-11-06 | Closed #8 and #9 (Vitest 5 needs both together), #10 (stay on Node 24 types), #11 (typescript-eslint rejects TypeScript 7) | none |
| 2026-11-06 | Renamed the project and GitHub repository to Traverse | #14 |
| 2026-11-06 | Release fixes, and `verify` required on `main`, which finishes FR-DP-7 | #16 |
| 2026-11-06 | Traverse specification, requirements, roadmap and README | #18 |
| 2026-11-06 | Released `v0.2.0` | #15 |
| 2026-11-06 | Project skills, guardrail reviewer and `main` guard. M0 is done. | `chore/agent-skills` |
| 2026-11-06 | Closed #17: the Vitest group left out `@vitest/coverage-v8`. Update both by hand when needed. | none |
| 2026-11-06 | Closed release #13, replaced by #15 after the package rename | none |
| 2026-11-06 | Closed release #6: `verify` failed on generated `CHANGELOG.md` and `.release-please-manifest.json` formatting | none |
| 2026-11-06 | Moved the local folder to `/home/titan/projects/traverse` | none |
| 2026-11-06 | Owner confirmed Frox can be used in an MIT project, which answers U-18 | `chore/web-tooling` |
| 2026-11-08 | Upstream resilience: a Redis cache whose entries are checked on the way out, stale reads for npm and GitHub but never OSV, retries within a deadline, a 429 cool-down, single flight, a concurrency limit, an entity cap across aliases, failure logs, and a daily check against the live sources. FR-SG-6 and FR-SG-10 stay planned until the router stack and the first scheduled run prove them. | `feat/upstream-resilience` |
| 2026-11-06 | `subgraphs/advisories`: live OSV advisories. An empty list only ever means OSV said so, and `fixedIn` must fall outside every affected range for this npm package. | `feat/advisories-subgraph` |
| 2026-11-06 | `subgraphs/repositories`: live GitHub data, joined to a package through `@requires`, with the token kept on the server. | `feat/repositories-subgraph` |
| 2026-11-06 | `subgraphs/packages`: live npm data, with every field held to a strict format, so emails can't get through. `fetchJson` in the kit adds timeouts, a size cap and no redirects. | `feat/packages-subgraph` |
| 2026-11-06 | `packages/subgraph-kit`: a subgraph from a name, SDL and resolvers, with health, verified user context, JSON logs with a trace ID, masked errors and SIGTERM shutdown. | `feat/subgraph-kit` |
| 2026-11-06 | M2 router spike, run first because GR-2 depended on it. Persisted operations run from local files with no paid plan (C-33). Anonymous reads decided in ADR 0015, and `SPEC.md`'s schema fixed for FR-SG-6. | `docs/spike-results` |
| 2026-11-06 | Public demo at <https://ayenisholah.github.io/traverse/>, deployed by `demo.yml`. A suite tests the live site after each deploy. The first deployment stalled for 10 minutes for an unknown reason, and the next took under 2. | #39, #40 |
| 2026-11-06 | `0.7.1` published from `release.yml` by trusted publishing, with provenance, and run from the registry on a planted break. FR-WB-16 is done. | #36, #37 |
| 2026-11-06 | npm package: `@ayenis/traverse`, a dependency-free bundle with a publish job. The owner published `0.7.0` by hand and added the trusted publisher. The scope matches the owner's npm username. | `ci/npm-publish`, `build/npm-scope` |
| 2026-11-06 | Released `v0.6.0` and `v0.7.0`. The Action can now be pinned to a tag. | #30, #33 |
| 2026-11-06 | `traverse` CLI and GitHub Action: reads `traverse.json`, `.graphql` files and inline `gql` tags, and comments on the pull request. Proven on [#32](https://github.com/ayenisholah/traverse/pull/32#issuecomment-6683679869), closed unmerged: it failed and commented on a planted break, then passed and updated that comment. | `feat/impact-cli` |
| 2026-11-06 | Impact check at `/impact`: edit a draft, compose it in a Web Worker, and see the fields, operations and screens it breaks. Answers U-20. | `feat/impact-check` |
| 2026-11-06 | Searchable graph map at `/`, on the Cosmo demo schemas, by keyboard. Composition runs ahead of time into `apps/web/src/generated/demo-graph.json`. | `feat/graph-map` |
| 2026-11-06 | `packages/design-tokens`: the Frox scale as semantic tokens and a Tailwind theme, with Poppins, contrast checks in both themes, and gates against `px` and raw colours. | `feat/design-tokens` |
| 2026-11-06 | README badges and a quality gates table, at the owner's request. The coverage badge shows the enforced gate, because a live one needs a service account. | `docs/readme-status` |
| 2026-11-06 | `packages/graph-core`: composition, field ownership and impact analysis, proven on the Cosmo demo schemas and in a Chrome Web Worker. Answers U-11. | `feat/graph-core` |
| 2026-11-06 | Integration and Playwright layers, and the testing rule in `AGENTS.md`, at the owner's request. Pulled forward from M3. NFR-9 stays planned until every route is covered. | `test/web-e2e` |
| 2026-11-06 | `apps/web` on Next.js, Tailwind and Radix, with every gate extended to `apps/` and `.tsx`. FR-WB-13 stays planned until `feat/design-tokens`. | `chore/web-tooling` |

## In progress

Nothing. Start the next item below.

## Next

In order:

1. `fix/upstream-limits` (FR-SG-6), from the guardrail review of #48: cap `Retry-After`, so one 429 can't pause a source until restart, and stop one client's batch from filling the shared 500-slot queue.
2. M3: `feat/web-server`, then `feat/sandbox-router`, `feat/route-view` and `feat/package-explorer`. Ask the owner first about React Flow and Monaco, which `SPEC.md` still lists.
3. Set aside by the owner on 2026-11-06: three frontend developers trying Traverse on their own repositories, for `docs/USER_FEEDBACK.md`. It's the last M1 exit item, and only the owner can arrange it.

## Blocked

| Item | Waiting on | Blocks |
|---|---|---|
| AWS account setup | Owner | Cognito, Bedrock and every AWS milestone. Not the public demo. |

## Notes for the next session

- Generate `package-lock.json` in a `node:24` container. Older npm drops optional `@emnapi` entries, and `npm ci` then fails in CI.
- Before pushing, run `npm ci` and `npm run check` on a clean clone in `node:24`, and stop if either fails.
- Release pull requests get no CI until closed and reopened, and again after each update.
- `apps/web` uses `eslint-plugin-react-hooks` and `@next/eslint-plugin-next` directly, not `eslint-config-next` (W-3).
- axe can't check contrast under jsdom, but the Playwright run can (W-4).
- The design source is the [Frox Figma file](https://www.figma.com/design/jWHhIpI52m6ABnQpcTzZkG/Frox_dashboard_v5?node-id=1169-12005). Compare `packages/design-tokens` with its variables when the MCP call limit resets (U-21).
- After changing `packages/design-tokens`, run `npm run generate:tokens`. A test fails if the CSS is stale.
- Add a contrast pair for each new token that carries text. The theme follows the OS setting, and there's no toggle yet.
- Pages uses the commit as the deployment ID, so rerunning a cancelled deployment fails at once. It needs a new commit.
- `npm run test:demo` rebuilds `apps/web/out` for `/traverse`, so run `build:web` again before `test:e2e` on its own.
- `vite preview` serves the export for Playwright. `serve` was rejected: its `compression` dependency has a high severity advisory.
- dependency-cruiser refuses local Node 25, so run the gates in `node:24`.
- `npm audit` reports 10 moderate `minimatch` findings through ESLint. They're dev-only, and CI audits production dependencies at high.
- Cosmo demo schemas are in `packages/graph-core/test/fixtures/cosmo-demo`, copied from tag `router@0.366.1`.
- `graph-core` must not pass composition's class instances to `graphql` (W-5). Print or read AST nodes instead.
- `graph-core` looks at field changes. Removed enum values and union members only show up if validation fails, which `feat/impact-check` should revisit.
- Remove the `@graphql-tools/utils` override in `package.json` once composition depends on a fixed version (W-6). After editing overrides, confirm the package is present before trusting `npm audit`: a missing package audits clean.
- `packages/cli` keeps its dependencies under `devDependencies`, because the bundle inlines them (ADR 0014). The Action runs from source, so it must not use `--omit=dev`.
- `ci:` and `docs:` commits don't open a release pull request, but the next `feat:` or `fix:` will.
- The owner chose to read inline `gql` tags as well as `.graphql` files. Tags left unreadable by `${...}` are listed as "Couldn't be checked" and only fail with `--strict`, which this repository's workflow sets. A tag that still parses is checked as written, so interpolated selections aren't seen.
- The impact check can't block a merge yet: only `verify` is required on `main`, and a pull request here runs its own copy of the Action through `uses: ./`. `ci/schema-checks` (GR-7) is where that gets decided, and it needs the owner, because it's a repository setting.
- The Action uses `GITHUB_TOKEN` only, because comments are matched on the `github-actions[bot]` login.
- The owner decided the public router allows anonymous reads and refuses invalid tokens (ADR 0015).
- Fields from a separate upstream are nullable in `SPEC.md`, because a non-null failure would null the whole `Package` (FR-SG-6).
- The router reads its environment before `router/config.yaml` (C-50), expands variables into its raw text, comments included (C-43), and merges every file in `CONFIG_PATH` (C-44). So the file writes every risky setting out literally (ADR 0017), and a deployment (M7) must pass `findUnsafeRouterEnvironment` from `packages/repo-checks`: only `CONFIG_PATH` (one file) and the six `ROUTER_*` variables, each in a strict format. Test that in the CDK task definition. The guardrail review found APQ, MCP and CORS bypasses through the environment before this.
- `upstream-check.yml` fails on any upstream error, so a brief npm, GitHub or OSV outage turns it red with no shape change, as on 2026-11-09. Re-run it before treating a failure as a shape change. Ask the owner before adding retries to it.
- `.gitleaks.toml` allows a 40-character hex value only in `router/config.json` and only for `generic-api-key`, because `wgc` keys schemas by SHA-1. The owner approved it on 2026-11-09. A global `[allowlist]` in gitleaks 8.24.3 ignores `condition` and would allow anything in that file, so keep it on the rule.
- Run `npm run generate:router` after changing a subgraph schema or `router/operations`. It needs Docker, and runs `wgc` 0.133.6 in a container with no network, so `wgc` never becomes a dependency (C-49). A test fails if the output is stale.
- `npm run test:router` needs Docker and host networking. It runs the subgraphs on ports 4101 to 4103 and the router on 3902 and 3903, so stop anything using them first.
- The depth limit is 3, the deepest the schema allows (C-45). A new nested field needs the limit raised on purpose, and the depth test then needs a deeper operation.
- `feat:` commits open release pull requests that publish to npm when merged, so merge those deliberately.
- For `workspace` in M4: add a shared `requireUser` helper, and make the subgraph refuse to start without auth settings. U-22 must be answered first.
- Run the guardrail mutations again after changing `packages/subgraph-kit`: its review showed tests can pass with a guard removed.
- `subgraphs/repositories` serves no private repository, because a package can name any repository. Release tags holding `@` read as no release, by choice (GR-16).
- Changing a schema's output shape means bumping `CACHE_VERSION` in `packages/subgraph-kit/src/upstream.ts`, or old entries are read as the new shape.
- `querySchema` in `subgraphs/advisories` is strict, so a new OSV response field fails closed. The scheduled check will report that, and the schema then needs updating.
- Hold upstream text to an allow-list, never a list of what to refuse. Review found ten ways past an email pattern. Schemas clean as they parse, so `fetchJson` output is safe to cache.
- `traverse.json` stays on the Cosmo demo. Adding the real subgraphs would compose them with it, so the router composes from `router/graph.yaml` instead, beside its operations.
- The Cosmo demo schemas define no owners, so the map shows "No owner set". The owner chose a config file, filled in by each team and kept in their repository, which `packages/cli` reads as `traverse.json`. A global store of owners was rejected: names aren't unique, ownership is private, and nobody could verify entries. Never invent owners.
- FR-WB-1 is marked done, but no real owner has appeared on screen yet, and the map doesn't read `traverse.json`. Check whether Cosmo labels or `CODEOWNERS` could replace the config file.
- The map is a keyboard-first list, not a React Flow canvas. `SPEC.md` still lists React Flow, so the owner should decide whether a visual canvas is wanted.
- After changing `graph/cosmo-demo` or `packages/graph-core`, run `npm run generate:demo`. A test fails if the data is stale.
- CI on `main` took 9 minutes once, on `b04b7d8`, against 1 to 2 minutes usually. Watch for a repeat.
- The impact check uses a plain `<textarea>`, not Monaco. `SPEC.md` still lists Monaco, and its React wrapper loads from a CDN by default, so the owner should decide.
- An unresolved CodeQL review thread blocks a merge even when every check passes, because `protect-main` requires threads to be resolved. Fix the finding, don't use `--admin`.
- Messages to a dedicated worker have an empty `origin`, and `compose.worker.ts` relies on that.
- The page must import only types from `graph-core`. A Playwright test fails if the composer reaches the map page.
- Merge pull requests with `gh pr merge --rebase --delete-branch` once checks pass on the current commit.
- Force-pushes need the owner's approval or the owner's own terminal.
- The owner asked about an Aurora or RDS database on 2026-11-08, and chose to plan it and finish M2 first. The engine stays RDS Postgres, as `SPEC.md` says, and Aurora would need an ADR. Postgres in Docker comes with `feat/workspace-subgraph` (M4), and RDS in CDK with `feat/data-stack` (M6), after account setup and the owner's confirmation of the first deploy.
- The owner chose to keep using the local AWS CLI user for read-only lookups. Its keys stay on that machine and never reach the repository or CI, where GR-5 applies.
- Release pull requests from `github-actions[bot]` wait for workflow approval. Approve the runs on the current head with `gh api -X POST repos/ayenisholah/traverse/actions/runs/<id>/approve`, after reading the diff.
- After a publish, npm can return 404 for a few seconds. Check again before treating it as a failure.
- Shell commands run in zsh, where an unquoted `$VAR` doesn't split into words. After a bulk edit, confirm the result with a search, not an exit code.
