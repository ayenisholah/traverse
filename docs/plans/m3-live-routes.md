# M3: Live routes

**Outcome:** the workbench runs real operations and shows each one's real route, and the Package explorer serves live data. No AWS access is needed.

**Status:** Planned. Detailed on 2026-11-09, after M2 closed. Nothing is built yet.

## Before starting: owner decisions

Ask these at the start of the first M3 session. Record each answer here and in `docs/PROGRESS.md`, and in an ADR where marked.

| # | Question | Needed by | Recommendation |
|---|---|---|---|
| D-1 | Keep Monaco, which `SPEC.md` lists, for the `/operations` editor? | `feat/route-view` | Ask. Monaco is heavy and hard to make fully keyboard- and screen-reader-friendly (NFR-9). A smaller editor, such as CodeMirror 6, is the alternative. Changing it needs a `SPEC.md` edit and an ADR. |
| D-2 | Keep React Flow, which `SPEC.md` lists, for the route view? | `feat/route-view` | Ask. A query plan is a small tree of fetches, so an ordered, keyboard-navigable list with an SVG outline may serve FR-WB-7 and NFR-9 better than a node canvas. Changing it needs a `SPEC.md` edit and an ADR. |
| D-3 | The public demo on GitHub Pages (FR-WB-15, done) is a static export. Once `apps/web` runs on a server, should the demo stay static (`/` and `/impact` only)? | `feat/web-server` | Keep it static, so FR-WB-15 can't regress and the demo needs no hosting. The server build adds the live routes. Prove both builds in the first branch. |

## Work, in roadmap order

### 1. `feat/web-server` (FR-WB-12, GR-9)

- **What:** move `apps/web` from `output: "export"` to a Node server runtime, with tRPC from browser to server. Keep a static build for the demo (D-3).
- **Typed operations (FR-WB-12):**
  - One set of `.graphql` documents feeds both the typed client and the public router's persisted operations.
  - `router/operations` already feeds `scripts/generate-router.ts`. Extend it, don't duplicate it.
  - A schema mismatch must fail the build: a contract test plus the generator.
- **Facts to verify first (`verify-fact`):**
  - The Next.js version's support for one app built both as a static export and as a server.
  - The tRPC adapter for the app router.
  - The codegen tool and version, for example GraphQL Code Generator. Pin it and record it.
- **GR-9 in M3:** sessions come in M4, so the M3 test is that the client bundle holds no secrets and no server-only env. Scan the built client chunks.
- **Exit:** both builds pass every existing test; one real operation goes from browser to tRPC to the router; a planted schema mismatch fails the build.

### 2. `feat/sandbox-router` (FR-GW-9, GR-11)

- **What:** a second router config, internal only, that returns query plans and runs free-form read operations.
- **Config:**
  - It uses `engine.debug.always_include_query_plan` (C-37), not dev mode.
  - It blocks mutations with `security.block_mutations` (C-52, documented only: test it first) and blocks subscriptions.
  - Complexity limits stay on.
  - Every risky setting is written out literally, with its own checks, because the router reads its environment first (C-50, ADR 0017).
  - Reuse `packages/repo-checks/src/router-config.ts`, with a sandbox rule set that allows the query plan and free-form reads but still bans dev mode, the playground, introspection and wildcard CORS.
- **Reachability:** only the web server can reach it. Locally, it publishes no host port and joins a private Docker network with the web server. In AWS (M7) it gets a security group that only the web service can reach.
- **Tests:** e2e on the pinned image. A mutation is rejected, a subscription is rejected, a read returns `extensions.queryPlan`, and nothing outside the private network can connect (GR-11).
- **Run `guardrail-reviewer`.** The review of `feat/local-router` found environment-variable bypasses, so expect the same questions.

### 3. `feat/route-view` (FR-WB-7)

- **What:** `/operations` takes a typed operation, sends it through the server to the sandbox router, and shows the plan as a route: the subgraphs and the fetch order.
- **Depends on:** D-1 and D-2.
- **Tests:**
  - Unit tests turn plan JSON (C-37 shape) into the route model, with recorded plans as fixtures.
  - An e2e test on the pinned router checks that the view matches the plan for the real `Package` operation.
  - Playwright and axe tests cover the route, in both themes.

### 4. `feat/package-explorer` (FR-WB-8, FR-WB-9)

- **What:**
  - `/packages/[name]` shows versions, repository and advisories from the graph, with loading, empty and error states.
  - A `package.json` check lists licences and advisories for each dependency.
- **Design point:** the public config allows 3 root fields and no aliases.
  - Checking a whole `package.json` means one persisted call per dependency, run by the server with a concurrency limit and a cap on dependencies.
  - The alternative is a `packages(names:)` list field, which needs a `SPEC.md` change. Decide in the branch, and say why.
- **Tests:**
  - Integration tests (FR-WB-9) compare against npm and OSV recordings for a real project.
  - Playwright and axe tests cover every state.
- **Screen map:** this branch's operations become the app's real screen map.

## Cross-cutting rules

- Every route adds Playwright and axe tests (`AGENTS.md`). NFR-9 is done only when every route is covered.
- Write the failing test first, keep 100% per-file coverage, and prove each new gate on a planted violation.
- Run each clean clone in `node:24` one at a time, and delete it straight after. `/tmp` is in memory, and ten leftover clones filled it on 2026-11-09.

## Exit

- The route view matches the router's plan for real operations.
- A mutation sent to the sandbox router is rejected.
- `package.json` results match npm and OSV for a real project.
- FR-WB-7, FR-WB-8, FR-WB-9, FR-WB-12, FR-GW-9, GR-9 (bundle part), GR-11 and NFR-9 are marked done with evidence.
