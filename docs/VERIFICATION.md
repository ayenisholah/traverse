# Verification

**Updated:** 2026-11-08

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
