# M3: Live routes

**Outcome:** the workbench runs real operations and shows each one's real route, and the Package explorer serves live data. No AWS access is needed.

**Status:** In progress. `feat/web-server` and `feat/sandbox-router` are built. The other two branches are planned.

## Owner decisions

Answered by the owner on 2026-11-16.

| # | Question | Answer | Record |
|---|---|---|---|
| D-1 | Keep Monaco for the `/operations` editor? | No. Use CodeMirror 6, bundled with the app. | [ADR 0018](../adr/0018-codemirror-operation-editor.md) |
| D-2 | Keep React Flow for the route view? | No. An ordered, keyboard-navigable list with an SVG outline. | [ADR 0019](../adr/0019-route-view-list.md) |
| D-3 | Does the GitHub Pages demo stay a static export once `apps/web` runs on a server? | Yes: `/` and `/impact` only. The server build adds the live routes. | `SPEC.md`, web app |

## Work, in roadmap order

### 1. `feat/web-server` (FR-WB-12, GR-9): built

Built on 2026-11-16. What follows is the plan it was built from. Three things differ: the generator emits each operation's hash, so no second hash can drift; the browser test calls the API with `fetch`, because the typed browser client arrives with the first live page in `feat/route-view`; and GR-9 stays planned until M4 adds sessions, with the bundle part tested now.

- **What:** move `apps/web` from `output: "export"` to a Node server runtime, with tRPC from browser to server. The demo stays a static build of `/` and `/impact` (D-3).
- **Typed operations (FR-WB-12):**
  - One set of `.graphql` documents feeds both the typed client and the public router's persisted operations.
  - `router/operations` already feeds `scripts/generate-router.ts`. Extend it, don't duplicate it.
  - A schema mismatch must fail the build: a contract test plus the generator.
- **Facts to verify first (`verify-fact`):**
  - The Next.js version's support for one app built both as a static export and as a server.
  - The tRPC adapter for the app router.
  - The codegen tool and version, for example GraphQL Code Generator. Pin it and record it.
- **Steps, in order:**
  1. Verify the three facts above and record them. If one app can't build both ways on the pinned Next.js, stop and report it, because D-3 depends on it.
  2. Two builds from one config. Today `next.config.ts` sets `output: "export"` and reads `BASE_PATH`, and `npm run check` runs `build:web`, `test:integration`, `test:e2e` and `test:demo` on the export. Keep those four passing unchanged on the static build, and add a server build with its own script and its own integration and Playwright runs.
  3. The static build must leave out the live routes and the tRPC handler, and a test must fail if `/operations` or `/packages` appears in `apps/web/out`.
  4. Typed operations from `router/operations`, which holds one document today, `package.graphql`.
  5. A tRPC procedure that runs `Package` against the public router, and one page or test that calls it from the browser.
  6. The bundle scan for GR-9, proven on a planted server-only value.
- **Design point: the persisted hash.** `scripts/generate-router.ts` names each persisted operation by the SHA-256 of the file's exact bytes (C-34). The server must send that same hash, so the typed client can't reprint a document and hash the result. Either the generator emits the hash beside the types, or a contract test fails when the two differ. Decide in the branch, and say why.
- **Where the server finds the routers:** from server-only settings, validated at start. None of them may carry the `NEXT_PUBLIC_` prefix, and the bundle scan covers that.
- **GR-9 in M3:** sessions come in M4, so the M3 test is that the client bundle holds no secrets and no server-only env. Scan the built client chunks.
- **Exit:** both builds pass every existing test; one real operation goes from browser to tRPC to the router; a planted schema mismatch fails the build.

### 2. `feat/sandbox-router` (FR-GW-9, GR-11): built

Built on 2026-11-16, as `router/sandbox.yaml`. The real graph has no mutation or subscription yet, so the tests use a test-only graph that has both, in `router/test/fixtures/sandbox-graph`. The web server doesn't call this router until `feat/route-view`. Rate limiting, which ADR 0011 asks for, needs Redis and comes with M7. GR-11 stays planned: a mutation is refused and the router answers on loopback only, but "no public route" can only be proven on the real network, in M7.

- **What:** a second router config, internal only, that returns query plans and runs free-form read operations.
- **Config:**
  - It uses `engine.debug.always_include_query_plan` (C-37), not dev mode.
  - It blocks mutations with `security.block_mutations` (C-52, documented only: test it first) and blocks subscriptions.
  - Complexity limits stay on.
  - Every risky setting is written out literally, with its own checks, because the router reads its environment first (C-50, ADR 0017).
  - Reuse `packages/repo-checks/src/router-config.ts`, with a sandbox rule set that allows the query plan and free-form reads but still bans dev mode, the playground, introspection and wildcard CORS.
- **Reachability:** only the web server can reach it. Locally, the test harness runs the subgraphs as host processes with host networking, so the sandbox router binds to loopback only, and a test proves a connection from outside loopback is refused. In AWS (M7) it gets a security group that only the web service can reach.
- **Tests:** e2e on the pinned image. A mutation is rejected, a subscription is rejected, a read returns `extensions.queryPlan`, and nothing outside the private network can connect (GR-11).
- **Run `guardrail-reviewer`.** The review of `feat/local-router` found environment-variable bypasses, so expect the same questions.

### 3. `feat/route-view` (FR-WB-7)

- **What:** `/operations` takes a typed operation, sends it through the server to the sandbox router, and shows the plan as a route: the subgraphs and the fetch order.
- **Decided:** CodeMirror 6 for the editor (ADR 0018), and an ordered list with an SVG outline for the route (ADR 0019). Pin the CodeMirror packages and record them in verified facts first.
- **Tests:**
  - Unit tests turn plan JSON (C-37 shape) into the route model, with recorded plans as fixtures.
  - An e2e test on the pinned router checks that the view matches the plan for the real `Package` operation.
  - Playwright and axe tests cover the route, in both themes.

### 4. `feat/package-explorer` (FR-WB-8, FR-WB-9)

- **What:**
  - `/packages/[name]` shows versions, repository and advisories from the graph, with loading, empty and error states.
  - A `package.json` check lists licences and advisories for each dependency.
- **Design point:** the public config allows 3 root fields and no aliases.
  - Decided on 2026-11-16: checking a whole `package.json` means one persisted call per dependency, run by the server with a concurrency limit and a cap on dependencies.
  - A `packages(names:)` list field was rejected, because it needs a schema change and looser limits on the public router.
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
- FR-WB-7, FR-WB-8, FR-WB-9, FR-WB-12, FR-GW-9 and NFR-9 are marked done with evidence. GR-9 and GR-11 have their M3 parts tested, and stay planned until M4's sessions and M7's network.
