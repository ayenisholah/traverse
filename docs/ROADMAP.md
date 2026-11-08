# Roadmap

**Updated:** 2026-11-06

Each branch is one pull request and lists the requirements it delivers. Plans for each milestone are in [`plans/`](plans/). [Progress](PROGRESS.md) shows the current state.

| Milestone | Outcome | Plan | Status |
|---|---|---|---|
| M0 | Foundation: tooling, specification, quality gates | [Plan](plans/m0-foundation.md) | Done |
| M1 | Public demo and CLI: graph map, impact check and a PR check, on real schemas | [Plan](plans/m1-workbench.md) | Waiting on user feedback |
| M2 | Real graph: npm, GitHub and OSV subgraphs behind the pinned Cosmo Router | [Plan](plans/m2-real-graph.md) | In progress |
| M3 | Live routes: web server, sandbox router, query plans, Package explorer | [Plan](plans/m3-live-routes.md) | Planned |
| M4 | Accounts and saved workspaces | [Plan](plans/m4-accounts.md) | Planned |
| M5 | AI assistant on Amazon Bedrock | [Plan](plans/m5-ai-assistant.md) | Planned |
| M6 | Network, data and edge in CDK | [Plan](plans/m6-network-data-edge.md) | Planned |
| M7 | Router, subgraphs and web app on staging | [Plan](plans/m7-services.md) | Planned |
| M8 | Observability | [Plan](plans/m8-observability.md) | Planned |
| M9 | Delivery pipeline | [Plan](plans/m9-delivery.md) | Planned |
| M10 | Load and resilience proof | [Plan](plans/m10-resilience.md) | Planned |
| M11 | Production launch | [Plan](plans/m11-production.md) | Planned |

[Account setup](plans/account-setup.md) must be complete before M4. The public demo doesn't depend on it.

## Branches

| Milestone | Branch | Requirements | Status |
|---|---|---|---|
| M0 | `chore/repo-tooling` | FR-DP-7 | Merged |
| M0 | `docs/readme` | FR-DP-8 | Merged |
| M0 | `docs/spec-and-requirements` | FR-DP-8, FR-DP-9 | Merged |
| M0 | `docs/agent-instructions` | FR-DP-9 | Merged |
| M0 | `ci/quality-gates` | FR-DP-7, FR-DP-8 | Merged |
| M0 | `docs/progress-log` | FR-DP-9 | Merged |
| M0 | `chore/rename-to-traverse` | FR-DP-8 | Merged |
| M0 | `ci/release-fixes` | FR-DP-7 | Merged |
| M0 | `docs/workbench-direction` | FR-DP-7, FR-DP-8 | Merged |
| M0 | `chore/agent-skills` | FR-DP-9 | Merged |
| M1 | `chore/web-tooling` | FR-WB-13 | Merged |
| M1 | `test/web-e2e` | NFR-9 | Merged |
| M1 | `docs/readme-status` | FR-DP-7 | Merged |
| M1 | `feat/graph-core` | FR-WB-3, FR-WB-4, FR-WB-6 | Merged |
| M1 | `feat/design-tokens` | FR-WB-13, NFR-9, NFR-10, GR-10 | Merged |
| M1 | `feat/graph-map` | FR-WB-1 | Merged |
| M1 | `feat/impact-check` | FR-WB-2, NFR-12 | Merged |
| M1 | `feat/impact-cli` | FR-WB-5 | Merged |
| M1 | `ci/npm-publish` | FR-WB-16 | Merged |
| M1 | `ci/demo-deploy` | FR-WB-15 | Merged |
| M2 | `docs/spike-results` | FR-GW-3, FR-GW-7 | Merged |
| M2 | `feat/subgraph-kit` | FR-SG-7, FR-OB-6 | Merged |
| M2 | `feat/packages-subgraph` | FR-SG-2, GR-16 | Merged |
| M2 | `feat/repositories-subgraph` | FR-SG-3 | Merged |
| M2 | `feat/advisories-subgraph` | FR-SG-4 | Merged |
| M2 | `feat/upstream-resilience` | FR-SG-6, FR-SG-10 | Merged |
| M2 | `feat/local-router` | FR-GW-2, FR-GW-4, FR-SG-5, GR-1, GR-2 | Planned |
| M3 | `feat/web-server` | FR-WB-12, GR-9 | Planned |
| M3 | `feat/sandbox-router` | FR-GW-9, GR-11 | Planned |
| M3 | `feat/route-view` | FR-WB-7 | Planned |
| M3 | `feat/package-explorer` | FR-WB-8, FR-WB-9 | Planned |
| M4 | `feat/web-auth` | FR-WB-10, GR-3 | Planned |
| M4 | `feat/workspace-subgraph` | FR-SG-1, FR-SG-9, FR-WB-11 | Planned |
| M5 | `feat/bedrock-client` | FR-AI-4, GR-13, GR-14, GR-15 | Planned |
| M5 | `feat/ai-explain` | FR-AI-1 | Planned |
| M5 | `feat/ai-suggest` | FR-AI-2, GR-12 | Planned |
| M5 | `feat/ai-draft` | FR-AI-3, GR-12 | Planned |
| M6 | `feat/network-stack` | NFR-7, GR-5 | Planned |
| M6 | `feat/data-stack` | NFR-5, NFR-7 | Planned |
| M6 | `feat/edge-stack` | FR-GW-6, NFR-6 | Planned |
| M7 | `feat/graph-service-construct` | FR-DP-5 | Planned |
| M7 | `feat/router-service` | FR-GW-1, FR-GW-3, FR-GW-5, FR-GW-7, FR-GW-8 | Planned |
| M7 | `feat/subgraph-services` | FR-GW-1 | Planned |
| M7 | `feat/migration-task` | FR-SG-8 | Planned |
| M7 | `feat/web-service` | FR-WB-14 | Planned |
| M8 | `feat/telemetry-pipeline` | FR-OB-1, FR-OB-2, FR-OB-5, GR-4 | Planned |
| M8 | `feat/dashboards` | FR-OB-3 | Planned |
| M8 | `feat/alarms-and-slos` | FR-OB-4 | Planned |
| M9 | `ci/schema-checks` | FR-DP-1, GR-7 | Planned |
| M9 | `ci/deploy-pipeline` | FR-DP-2, FR-DP-3, FR-DP-6, GR-8 | Planned |
| M9 | `feat/github-oidc-roles` | FR-DP-4, GR-5, GR-6 | Planned |
| M10 | `test/load-suite` | NFR-1, NFR-2, NFR-3, NFR-11 | Planned |
| M10 | `test/resilience-suite` | FR-GW-3, NFR-4, NFR-5 | Planned |
| M10 | `docs/resilience-results` | NFR-1, NFR-4, NFR-5 | Planned |
| M11 | `feat/production-environment` | FR-GW-1, NFR-6 | Planned |
| M11 | `docs/runbooks` | NFR-8 | Planned |
