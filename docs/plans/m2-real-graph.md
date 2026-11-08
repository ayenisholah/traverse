# M2: Real graph

**Status:** Done on 2026-11-08. FR-SG-10 waits for the first run of `upstream-check.yml` after the merge.

**Outcome:** one federated query returns live npm, GitHub and OSV data through the pinned Cosmo Router, in Docker. No AWS access is needed.

## Work

1. `docs/spike-results`: the router questions first, because GR-2 depended on them. Persisted operations, JWT rules and query plans are proven on the pinned image (C-31 to C-42).
2. `feat/subgraph-kit`: server, health, token verification, logging and shutdown.
3. `feat/packages-subgraph`, `feat/repositories-subgraph`, `feat/advisories-subgraph`: tests first, replaying recorded real responses.
4. `feat/upstream-resilience`: caching, retries, rate limit handling, and a scheduled check against the live sources.
5. `feat/local-router`: compose config, JWT, persisted operations, limits, and the production config test for GR-1. That test also bans `engine.debug.always_include_query_plan`, `demo_mode` and both forms of the introspection and playground settings.

## Exit

Each is a test in `router/test/e2e/router.test.ts`, run in `verify`:

- An end-to-end test passes against the pinned router image.
- One operation joins a real package, repository and advisories.
- A non-persisted operation is rejected on the public config.
- With one upstream blocked, the others still return.
- A request with no token gets public data, and an invalid token is refused.
