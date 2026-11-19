# Verification

**Updated:** 2026-11-16

This file records proof that isn't a named test. Each gate below was run on a clean tree, where it passed, and then on a planted violation, where it failed. Exit codes were checked one at a time.

## Quality gates (FR-DP-7)

| Gate | Command | Planted violation | Result |
|---|---|---|---|
| Format | `npm run format:check` | Misformatted file | Exit 1, file named |
| Lint | `npm run lint` | `console.log` in package source | Exit 1, `no-console` |
| Types | `npm run typecheck` | String assigned to a number | Exit 2, `TS2322` |
| Boundaries | `npm run check:deps` | Subgraph importing a subgraph | Exit 1, `subgraphs-do-not-import-subgraphs` |
| Boundaries | `npm run check:deps` | Package importing a subgraph | Exit 1, `packages-stay-inward` |
| Boundaries | `npm run check:deps` | Import of a package's internals | Exit 1, `no-deep-package-imports` |
| Boundaries | `npm run check:deps` | Circular import | Exit 1, `no-circular` |
| Boundaries | `npm run check:deps` | Node built-in in `packages/domain` | Exit 1, `domain-has-no-io` |
| Boundaries | `npm run check:deps` | Node built-in in `packages/graph-core` | Exit 1, `graph-core-runs-in-browsers` |
| Duplication | `npm run check:dupes` | Copied source file | Exit 1, one clone |
| Unused code | `npm run check:unused` | Orphan file | Exit 1, file named |
| Unused code | `npm run check:unused` | Unused export | Exit 1, export named |
| Hygiene | `npm run check:hygiene` | Focused test, unticketed TODO, unexplained disable, `any`, coverage exclusion, attribution line | Exit 1, each one reported |
| Traceability | `npm run check:traceability` | Unknown requirement ID | Exit 1, ID and line named |
| Traceability | `npm run check:traceability` | `done` requirement with no evidence | Exit 1, requirement named |
| Traceability | `npm run check:traceability` | Roadmap branch with no requirement | Exit 1, branch named |
| Progress log | `npm run check:progress` | Branch with work and no progress update | Exit 1, log named |
| Coverage | `npm run test:coverage` | Uncovered function | Exit 1, below the 100% per-file threshold |
| Tests | `npm test` | Changed behaviour | Exit 1, tests failed |
| Tests | `CI=1 npm test` | Test marked `.only` | Exit 1, `.only` refused |
| Commit messages | `npx commitlint` | Attribution line, filler subject, schedule label | Exit 1, each rule reported |
| Secrets | `gitleaks` 8.24.3 over full history | Committed AWS key and GitHub token | Exit 1, two leaks found |
| Secrets allowlist | `gitleaks` 8.24.3 with `.gitleaks.toml` | In `router/config.json`, a GitHub token, and a generic key that isn't hex; the same schema hash in another file | Each caught, while the real config's three schema hashes pass |
| Dependencies | `npm audit --omit=dev --audit-level=high` | Project depending on `lodash` 4.17.20 | Exit 1 |

The traceability run first passed on the `done` plant, because a test fixture named a real ID and counted as evidence. Fixtures now use a prefix no real requirement has.

## Web gates (FR-WB-13)

Run on 2026-11-06 in a clean clone in `node:24`, with each violation planted in `apps/web`.

| Gate | Command | Planted violation | Result |
|---|---|---|---|
| Lint | `npm run lint` | Conditional hook in `.tsx` | Exit 1, hook rule reported |
| Lint | `npm run lint` | `<img>` element | Exit 1, through `--max-warnings 0` |
| Hygiene | `npm run check:hygiene` | `any` in `apps/web/src` | Exit 1, file and line named |
| Boundaries | `npm run check:deps` | `.tsx` importing a package's internals | Exit 1, `no-deep-package-imports` |
| Unused code | `npm run check:unused` | Orphan `.tsx` file | Exit 1, file named |
| Duplication | `npm run check:dupes` | Copied `.tsx` files | Exit 1, two clones |
| Coverage | `npx vitest run --coverage` | Uncovered branch in `page.tsx` | Exit 1, 50% branches, file named |
| Accessibility | `npx vitest run --project web` | Image with no alt text | Exit 1, `image-alt` |
| Types | `npm run typecheck` | Type error in `apps/web/src` | Exit 2, TS2322 |
| Web build | `npm run build:web` | Import of a missing file | Exit 1, module not found |
| Web build | `npm run build:web` | Server-only route | Exit 1, refused under `output: "export"` |

The `<img>` plant first passed, because the Next rules only warn. `npm run lint` now fails on warnings.

## Browser and integration gates (NFR-9)

Run on 2026-11-06 in a clean clone in `node:24`, against a rebuilt static export. Chromium came from `npx playwright install --with-deps chromium`.

| Gate | Command | Planted violation | Result |
|---|---|---|---|
| Integration | `npm run test:integration` | Page with no heading | Exit 1, test named |
| End to end | `npm run test:e2e` | `#eee` text on `#fff` | Exit 1, `color-contrast` |
| End to end | `npm run test:e2e` | Empty stylesheet | Exit 1, one test failed |
| End to end | `npm run test:e2e` | `console.error` in the browser | Exit 1, one test failed |
| End to end | `npm run test:e2e` | `test.only` | Exit 1, refused by `forbidOnly` |
| Hygiene | `npm run check:hygiene` | `test.only` in `apps/web/test/e2e` | Exit 1, file and line named |

The contrast plant passed the jsdom axe test with exit 0, then failed in Playwright. That matches W-4.

## Design token gates (FR-WB-13, NFR-9, NFR-10)

Run on 2026-11-06 in a clean clone in `node:24`.

| Gate | Command | Planted violation | Result |
|---|---|---|---|
| Hygiene | `npm run check:hygiene` | `2px` in `globals.css` | Exit 1, file and line named |
| Hygiene | `npm run check:hygiene` | `mt-[3px]` in `.tsx` | Exit 1, file and line named |
| Hygiene | `npm run check:hygiene` | `text-[#ff0000]` in `.tsx` | Exit 1, file and line named |
| Contrast | `npx vitest run --project node` | `fg-muted` set to `#a0a0a0` | Exit 1, three pairs failed |
| Generated CSS | `npx vitest run --project web` | Token source changed with no regeneration | Exit 1, test named |
| Tailwind theme | `npm run build:web` | `bg-red-500` on the page | No CSS emitted for the class |
| End to end | `npm run test:e2e` | Description set to `text-fg-subtle` | Exit 1, `color-contrast` |
| End to end | `npm run test:e2e` | Poppins 600 not imported | Exit 1, one test failed |
| End to end | `npm run test:e2e` | Heading size fixed in `px` | Exit 1, one test failed |

GR-10: the written licence record is in [ADR 0010](adr/0010-tailwind-radix-frox-scale.md) and U-18, and it merged with the first Frox-derived file.

The missing font plant first passed, because `document.fonts.check` returns true for a font that hasn't loaded (W-9). The test now reads each face's status.

## Graph map (FR-WB-1)

Run on 2026-11-06. The end-to-end plants ran in a clean clone in `node:24`.

| Gate | Command | Planted violation | Result |
|---|---|---|---|
| End to end | `npm run test:e2e` | Enter no longer opens a type | Exit 1, three tests failed |
| End to end | `npm run test:e2e` | Focus no longer moves to the opened type | Exit 1, three tests failed |
| End to end | `npm run test:e2e` | Fields table wider than a phone | Exit 1, one test failed |
| UI | `npx vitest run --project web` | Wrong `aria-activedescendant` | Exit 1, three tests failed |
| UI | `npx vitest run --project web` | An invented owner in place of "No owner set" | Exit 1, one test failed |
| Generated data | `npx vitest run --project web` | Schema changed with no regeneration | Exit 1, test named |

The generated data plant first passed because its `sed` matched nothing in the schema. It was rerun with a real change.

## Impact check (FR-WB-2, NFR-12)

Run on 2026-11-06. The end-to-end plants ran in a clean clone in `node:24`.

| Gate | Command | Planted violation | Result |
|---|---|---|---|
| End to end | `npm run test:e2e` | Composition moved onto the main thread | Exit 1, three tests failed, including both NFR-12 tests |
| End to end | `npm run test:e2e` | A breaking draft called safe | Exit 1, two tests failed |
| UI | `npx vitest run --project web` | Answers to older drafts accepted | Exit 1, test named |
| UI | `npx vitest run --project web` | No pause before checking | Exit 1, test named |

The pause plant first passed, because fake timers can't tell 300 ms from 0 ms. A test now checks both sides of the pause.

## Agent rules (FR-DP-9)

`AGENTS.md` sets the order of truth and accuracy rules, the `verify-fact` skill defines how a claim is checked and recorded, and `docs/VERIFIED_FACTS.md` records each Cosmo, AWS and upstream claim with a source and status. Reviewed on 2026-11-06.

`.claude/hooks/block-main.sh` was run against 12 commands. It blocked commits and pushes from a `main` checkout, and pushes to `main` from a branch, including `git -C`. It allowed feature branch work, including a command that mentions `main` outside the push. The first version failed two of these cases: a false positive on any such mention, and a bypass through `git -C`.

## Required checks (FR-DP-7)

`verify` is a required status check in the `protect-main` ruleset. `gh api repos/ayenisholah/traverse/rules/branches/main` lists it, alongside the pull request, linear history, deletion and force-push rules. On 2026-11-06, release #15 showed as mergeable with the rule active, after a passing `verify`.

## Router gates (GR-1, GR-2, FR-GW-4)

Run on 2026-11-08 against the pinned router image, with each violation planted in a working tree and then removed.

| Gate | Command | Planted violation | Result |
|---|---|---|---|
| GR-1 config | `npx vitest run router/test/config.test.ts` | `dev_mode: true` | Failed, `dev_mode` named |
| GR-1 config | `npx vitest run router/test/config.test.ts` | `query_plans_enabled: ${PLANS}` | Failed, `query_plans_enabled` named |
| GR-1 config | `npx vitest run router/test/config.test.ts` | `"*"` as the CORS origin | Failed, `cors.allow_origins` named |
| GR-1 config | `npx vitest run router/test/config.test.ts` | The `playground` block removed, leaving the default | Failed, `playground.enabled` named |
| Composition | `npx vitest run router/test/config.test.ts` | A field added to the `advisories` schema | Failed, stale config named |
| Persisted operations | `npx vitest run router/test/config.test.ts` | A field added to `router/operations/package.graphql` | Failed, stale operations named |
| Cost limits | `npm run test:router` | Field limit raised from 60 to 500 | 1 of 19 failed, the field limit test |
| GR-1 config | `npx vitest run router/test/config.test.ts` | The `automatic_persisted_queries`, `mcp`, `condition` and `on_error` settings each removed, `match_origins: [".*"]`, and an unknown variable in a value and in a comment | Failed each time |
| Environment | Pinned image with `APQ_ENABLED`, `MCP_ENABLED`, `CORS_MATCH_ORIGINS` and the block condition set | Run against the fixed config | Registration refused, text blocked, no CORS header, no MCP listener |

## Web server gates (FR-WB-12, FR-WB-15, GR-9)

Run on 2026-11-16 in `node:24`. Each passed on a clean tree and failed on the planted violation.

| Gate | Command | Planted violation | Result |
|---|---|---|---|
| Typed operations | `npx vitest run router/test/config.test.ts` | `apps/web/src/generated/operations.ts` missing | Failed, "run npm run generate:router" |
| Typed operations | `npx vitest run router/test/config.test.ts` | A schema without a field `package.graphql` asks for | Generation rejects, `Cannot query field "weeklyDownloads"` |
| Static export holds no live route | `npm run build:web && npm run test:integration` | `src/app/operations/page.tsx` | Failed, `operations.html` named |
| Browser code holds no server setting | `npm run build:web && npm run build:server && npm run test:integration` | `process.env.PUBLIC_ROUTER_URL` read in a client component | Failed for both builds, chunk and name reported |
| Server needs its settings | `npm run test:integration` | `next start` with no `PUBLIC_ROUTER_URL` | The process exits 1 and names the setting |
| Server code stays on the server | `npm run check:deps` | A browser component importing `apps/web/src/server/settings.ts` | Exit 1, `web-server-code-stays-on-the-server` |

## Sandbox router gates (FR-GW-9, GR-11)

Run on 2026-11-16 against the pinned router image.

| Gate | Command | Planted violation | Result |
|---|---|---|---|
| Sandbox config rules | `npx vitest run router/test/config.test.ts` | `security.block_mutations.enabled: false` in `router/sandbox.yaml` | Failed, setting named |
| Mutations refused | `npm run test:router` | The same | Failed: the mutation reached the subgraph |
| Loopback only | `npm run test:router` | The sandbox bound to `0.0.0.0` | Failed: the connection from another address was accepted |
| Secret scan beside the allowed fixture | gitleaks 8.24.3 with `.gitleaks.toml` | A key in a new file in `router/test/fixtures/sandbox-graph`, and a key inside its `config.json` | One leak found each time |
| Sandbox access log | `npm run test:router` | `access_logs` removed from `router/sandbox.yaml` | Failed: the GET's operation text was in the log |
| Sandbox config is an allow-list | `npx vitest run packages/repo-checks/test/router-config.test.ts` | A routing override, a second listener, exported variables, forwarded headers, plugins | Each one named |
| One config file per router | The same | The public environment naming `sandbox.yaml`, and the other way round | `CONFIG_PATH` named |

## Route view (FR-WB-7)

Run on 2026-11-16.

| Check | Command | What it showed |
|---|---|---|
| The route matches the router's plan | `npm run test:router` | For the real `Package` operation on the pinned image, the server's route has `packages` in the first stage and `repositories` and `advisories` together in the second, as read off the plan fetched from the sandbox router directly |
| The editor's checker and the page share one copy of graphql | `npm run test:e2e:server` | An unknown field is marked in Chromium with no page error. Under Vite without the alias, the same check threw "from another module or realm" |
| The completion list passes axe | `npm run test:e2e:server` | Failed `scrollable-region-focusable` while the list scrolled, and passed once it was shown whole |
| A subgraph's message stays on the server | `npm run test:router` | The sandbox router returned a planted subgraph message with `data` and a plan; through `/api/trpc/route`, a GitHub outage returned the route and no upstream text |
| The API refuses an oversized body | `npx vitest run apps/web/test/server/api.test.ts` | A 40 KB body got 413 and the sandbox was never called |
| Only the erasable type import passes | `npm run lint` | `import { type Settings } from "../server/settings.ts"` in browser code failed `no-import-type-side-effects` |

## Package explorer (FR-WB-8, FR-WB-9, NFR-9)

Run on 2026-11-16.

| Check | Command | What it showed |
|---|---|---|
| A real package.json matches npm and OSV | `npm run test:router` | For each dependency of `packages/subgraph-kit`, frozen as a fixture, and for a manifest pinning `lodash` 4.17.20, the licence matched the npm recording and the advisory IDs matched the OSV recording for the version checked. Every query was recorded, so none could pass as "no advisories" |
| A real finding | The same | `zod` `^4.0.0` allows 4.0.0, which has GHSA-mrhx-c7xc-m3w5 (fixed in 4.6.6). The lockfile installs 4.6.7 |
| Every route meets WCAG 2.2 AA | `npm run test:e2e`, `npm run test:e2e:server` | axe found no violations on `/`, `/impact`, `/operations`, `/packages` and a package page, in both themes, and each flow ran by keyboard |

## Public router allow-list (GR-1, GR-4)

Run on 2026-11-18.

| Check | Command | What it showed |
|---|---|---|
| A setting with no rule fails the shipped config | `npx vitest run router/test/config.test.ts` | With `override_routing_url.subgraphs.packages` planted in `router/config.yaml`, the new test failed on the old rules, which passed it, and passed on the new ones, which report it |
| Neither router lets an unruled key through | `npx vitest run packages/repo-checks/test/router-config.test.ts` | A routing override, a second listener, exported variables, plugins, a graph token, printed plans and an empty section each failed both rule sets |
| The public access log keeps no part of a GET's operation | `npm run test:router` | A GET carrying a planted query and variables failed the new test on the pinned router with the old config, and passed with `access_logs.router.ignore_query_params_list` set: neither planted value was in the log (C-55) |

## Sign-in (FR-WB-10, GR-9)

Run on 2026-11-19, against the local issuer in `router/test/support/issuer.ts`. A real user pool hasn't been tried, so FR-WB-10 is `partial`.

| Check | Command | What it showed |
|---|---|---|
| The code flow runs end to end in a browser | `npm run test:e2e:server` | Sign-in returned to the page that asked, the session survived a new page, a dropped access token was refreshed, sign-out cleared both cookies, and the same ran by keyboard |
| The browser can't read the session | The same | Both cookies were `HttpOnly` and `SameSite=Lax`, and `document.cookie` was empty |
| The routes work against the issuer over HTTP | `npx vitest run apps/web/test/server/auth-routes.test.ts` | Sign-in, refresh and sign-out ran on the real route modules. The issuer recorded the refresh and the revoked refresh token, and no access token appeared in a cookie or an answer |
| A changed, expired or foreign cookie opens as nothing | `npx vitest run apps/web/test/server/cookies.test.ts` | Each case gave no session, and a 2,000-character token sealed to under 4,096 bytes |
| An ID token can't stand in for an access token | `npx vitest run packages/subgraph-kit/test/subgraph.test.ts` | Tokens with `token_use` `id`, missing or `refresh` all gave no user, and failed before the check was added |
| No sign-in setting reaches the browser | `npm run test:integration` | The browser bundle held none of the six setting names |
| Every sign-in state meets WCAG 2.2 AA | `npm run test:e2e:server` | axe found no violations signed out, signed in, or on the failed page, in both themes |

## Saved workspaces (FR-WB-11, FR-SG-1, FR-SG-9, GR-3)

Run on 2026-11-19.

| Check | Command | What it showed |
|---|---|---|
| A user saves and reopens a workspace, from sign-in to Postgres | `npm run test:router` | Through the built server, signed in at the local issuer, a save went through the pinned router and the workspace subgraph into Postgres, and reopened with its drafts and screen map |
| One user reaches none of another's workspaces through any operation | The same | Through the router, another user's token listed none, opened none, couldn't update (`NOT_FOUND`) and couldn't delete, and the owner's workspace was unchanged. The same held on the real SQL in `subgraphs/workspace/test/postgres` |
| A forged header has no effect | The same | `x-user-id` with no token got `UNAUTHENTICATED`, and with another user's token opened nothing. A bearer token sent to the web server with no session cookie got 401 |
| An ID token can't open workspaces | The same | A token whose audience was the app client was refused with 401 before any subgraph |
| No operation takes a user ID | `npx vitest run subgraphs/workspace` | `workspaces(userId: ...)` was refused as an unknown argument |
| Saved work survives a restart | `npm run test:router` | A workspace saved through one connection pool read back the same through a new one, and each migration ran once |
| The subgraph won't start without token settings | `npx vitest run packages/subgraph-kit subgraphs/workspace` | It threw at creation with no `JWKS_URL`, `JWT_AUDIENCE` and `JWT_ISSUER` |
| Saving works in a browser, by keyboard, with no WCAG 2.2 AA violations | `npm run test:e2e:server` | Saved, signed out, signed in again in a new browser context and reopened from `/workspaces`; deleted; and axe found nothing on the bar or the list in either theme |

## The assistant's model boundary (GR-13, GR-14, GR-15)

Run on 2026-11-19, against the local stand-in in `router/test/support/model-stub.ts`. No real model has been called, so GR-13 is `partial`.

| Check | Command | What it showed |
|---|---|---|
| The real SDK reaches Bedrock's wire format | `npx vitest run apps/web/test/server/assistant` | Through `@aws-sdk/client-bedrock-runtime` 3.1162.0, the stand-in received the forced `answer` tool, its JSON schema and `maxTokens` 2048, and each Bedrock error type came back as a fixed reason (A-18) |
| Only a schema-shaped answer passes | The same | An extra field, a value over its limit, another tool and plain text were each `invalid` |
| Planted text stays data | The same | An instruction planted in a schema, with a forged closing marker, stayed inside its block, before the one real closing marker |
| Prompts hold no secrets or identity | The same | A JWT, a bearer token, an AWS key ID, a private key and an email were removed, and the user's subject was in no prompt and no counter key |
| Calls are bounded | The same, and `npm run test:router` | A user's calls past the daily cap, everyone's past the global cap, and any call when the counter was down were refused before the model. On real Redis 7.4.12 the count held across clients and instances, and `EXPIRE NX` set each key's lapse once |
| The scrubber can't be made slow | `npx vitest run apps/web/test/server/assistant/prompt.test.ts` | Long runs of letters, `eyJ`, private-key headers, `@` and `Bearer`, each as large as a call may carry, were all scrubbed in under 500 ms together. The first email pattern took over 8 seconds on 60,000 letters, and the review found the first JWT pattern took 4 seconds on repeated `eyJ`; both were replaced |
| Local runs never use the machine's AWS credentials | `npx vitest run apps/web/test/server/assistant/runtime.test.ts` | With an AWS key in the environment, the stand-in saw requests signed by the test key, never that one |
| Nothing about a call is written out | The same | An answered call and a failed one wrote nothing to stdout, stderr or the console, and the planted email reached no prompt |
