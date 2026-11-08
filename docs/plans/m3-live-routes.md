# M3: Live routes

**Outcome:** the workbench runs real operations and shows each one's real route, and the Package explorer serves live data. No AWS access is needed.

## Work

1. `feat/web-server`: move `apps/web` to a server runtime, with tRPC from browser to server and generated typed operations.
2. `feat/sandbox-router`: an internal router that serves query plans and read-only free-form operations (GR-11). It uses `engine.debug.always_include_query_plan`, not dev mode (C-37). It gets its own config file and checks, and writes its risky settings out as ADR 0017 requires, because the router reads its environment first (C-50).
3. `feat/route-view`: the query plan as a route.
4. `feat/package-explorer`: package pages and the `package.json` check, whose operations become the app's real screen map.
5. Each route adds its own Playwright and axe tests, under the rule in `AGENTS.md`. Tests that need the pinned router arrive with `feat/route-view`.

## Exit

- The route view matches the router's plan for real operations.
- A mutation sent to the sandbox router is rejected.
- `package.json` results match npm and OSV for a real project.
