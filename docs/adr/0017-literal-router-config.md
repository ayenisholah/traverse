# 0017: Write every risky router setting out, and hold the router's environment to a list

**Status:** Accepted

## Context

GR-1 and GR-2 were first checked by parsing `router/config.yaml` and treating a missing key as safe. A guardrail review then showed the pinned router reads its environment first and lays the file on top (C-50), so a missing key still takes its environment variable. With the file passing the check, `APQ_ENABLED=true` let clients register operations, `CORS_MATCH_ORIGINS=.*` allowed any origin with credentials, and `MCP_ENABLED=true` handed out the whole schema (C-51).

The router also expands variables into the file's raw text, comments included, before parsing it (C-43). A value holding a newline can add keys the check never sees.

## Decision

- `router/config.yaml` writes out every setting that could weaken GR-1 or GR-2, even where it matches the default. `findBannedRouterSettings` fails on any that are missing or unsafe, including client-registered operations, MCP, ConnectRPC, CORS patterns, the block's condition and `on_error`.
- The file may use only six known variables, checked by `findUnknownRouterVariables`.
- A deployment's whole environment must pass `findUnsafeRouterEnvironment`: only a single-file `CONFIG_PATH` and those six variables, each in a strict format. The e2e harness runs the router under the same check.

## Consequences

- A setting can't be turned back on from the environment, and the e2e suite proves it on the pinned image.
- M7's router service must test its task definition's environment with `findUnsafeRouterEnvironment`, and set nothing else.
- A new risky router setting, or a new variable, needs a rule here first.
- The sandbox router (ADR 0011) has its own config and checks, because it allows query plans and free-form reads.
