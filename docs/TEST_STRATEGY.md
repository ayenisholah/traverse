# Test strategy

Tests come first, and a bug fix starts with a failing test.

## Layers

| Layer | What it proves | Tooling | Runs |
|---|---|---|---|
| Unit | Logic, through public functions and small fakes | Vitest | Every pull request |
| Component | Pages and components render, and axe finds no violations | Vitest, Testing Library, axe-core, jsdom | Every pull request |
| Property | Rules that must hold for any input, such as workspace scoping | fast-check | Every pull request |
| Mutation | Tests catch breakage in auth, workspace scoping and policy code | Stryker | Scheduled, and on those modules |
| Integration | Parts working together for real: the built export, the CLI, and subgraphs as real processes, with Postgres later | Vitest | Every pull request |
| Contract | Subgraphs compose, and the router's composed config and persisted operations match the schemas and operations in the repository | `wgc` in a container, stale-output tests | Every pull request |
| End to end | A user's journey in a real browser against the static export, and the real graph behind the pinned router image with its public config, tokens and persisted operations | Playwright, `@axe-core/playwright`, Vitest, Docker | Every pull request |
| Infrastructure | Resources, IAM and guardrails | CDK assertions, `cdk-nag` | Every pull request |
| Post-deploy | A release works where it landed | Smoke tests | Every deploy |
| Load and resilience | SLOs, scaling and recovery | k6, AWS FIS | Before launch, then on demand |

Vitest, Testing Library, axe-core and Playwright are in the repository today. Each other tool arrives with the first feature that needs it.

axe can't judge colour contrast under jsdom (W-4), so component tests prove nothing about it. Contrast needs its own token check and the Playwright axe run.

## What each thing needs

| What | Tests | Where |
|---|---|---|
| Function | Unit | `test/*.test.ts` |
| Component | UI: its states, plus an axe check | `apps/*/test/*.test.tsx` |
| Feature | Integration | `apps/*/test/integration/`, `packages/*/test/integration/` |
| Feature | Playwright end to end, including an axe check | `apps/*/test/e2e/` |
| Public demo | Playwright with relative URLs, on a `/traverse` build and after each deploy | `apps/web/test/demo/` |
| Router config | Unit: GR-1 and GR-2 on the public config, and stale generated files | `router/test/*.test.ts` |
| Router behaviour | End to end on the pinned image, with the public config unchanged | `router/test/e2e/` |

A pure function has no screen to drive, so it needs no Playwright test of its own. The feature that uses it does. The CLI has no browser at all: its integration tests run the real command, install the packed tarball, and a real pull request proves the Action end to end.

## Coverage policy

`npm run test:coverage` requires 100% lines, branches, functions and statements, per file. Database tests that are skipped therefore fail the gate.

Adding an exclusion needs a reason here and in `vitest.config.ts`. Try moving the logic out of the entrypoint first. There are no exclusions today.

## Writing good tests

- Coverage shows that code ran, not that it's correct. Each test should fail if the behaviour breaks.
- Name the requirement ID in the test name, for example `[FR-SG-5] joins a package to its repository`.
- Every guardrail has a test.
- Avoid real timers.
- Fixtures are recorded real public responses, not invented data. Tests never call live services; a scheduled check does that (FR-SG-10).

## Proving a gate works

A new gate must be shown to fail on a planted violation before it's trusted. Check each command's exit code on its own, so that one failure can't hide behind another. Record the result in [verification](VERIFICATION.md).
