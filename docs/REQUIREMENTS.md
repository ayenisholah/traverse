# Requirements

**Status:** Draft v2 · **Updated:** 2026-11-06
**Related:** [Specification](../SPEC.md) · [Roadmap](ROADMAP.md) · [Test strategy](TEST_STRATEGY.md)

Every requirement has an ID, a testable acceptance check, how it's verified, the milestone that delivers it and a status. A requirement moves to `done` only when its check has passed and the evidence is recorded, as a test named `[ID]` or an entry in [verification](VERIFICATION.md). `partial` means some of its check is met so far.

**ID prefixes:** `FR-WB` workbench · `FR-AI` AI assistant · `FR-GW` gateway · `FR-SG` subgraphs · `FR-DP` delivery · `FR-OB` observability · `NFR` non-functional · `GR` guardrail.

## Workbench

| ID | Requirement | Acceptance check | Verified by | Milestone | Status |
|---|---|---|---|---|---|
| FR-WB-1 | Show the graph as a map. | Subgraphs, entities and owners render from real SDL, and a type can be found and opened by keyboard. | e2e | M1 | done |
| FR-WB-2 | Compose schema drafts in the browser. | Editing a draft runs Cosmo composition in a Web Worker and shows its errors, with the page still responding. | e2e | M1 | done |
| FR-WB-3 | Show what a schema change breaks. | A change to a field lists every operation and screen that uses it, and no others. | unit | M1 | done |
| FR-WB-4 | Find who owns a field. | Any field resolves to its subgraphs and their owners, using composition output. | unit | M1 | done |
| FR-WB-5 | Check a repository from the command line and CI. | The CLI exits non-zero on a broken operation, and the GitHub Action comments on a real pull request with broken operations and screens. | CI | M1 | done |
| FR-WB-6 | Work on any Federation SDL. | The Cosmo demo subgraph schemas compose and map correctly, with no project-specific code. | contract | M1 | done |
| FR-WB-7 | Show a query's route. | The route view's subgraphs and fetch order match the plan the router returns for that operation. | e2e | M3 | planned |
| FR-WB-8 | Explore real package data. | A package's versions, repository and advisories render from the graph, and loading, empty and error states all render. | e2e | M3 | planned |
| FR-WB-9 | Vet a project's dependencies. | Pasting a real `package.json` shows licences and advisories that match npm and OSV. | integration | M3 | planned |
| FR-WB-10 | Sign in through Cognito. | Sign-in uses authorization code with PKCE, sessions expire and refresh, and signing out ends the session. | e2e | M4 | planned |
| FR-WB-11 | Save a workspace. | A signed-in user saves schema drafts and a screen map and reopens them in a new session. | e2e | M4 | planned |
| FR-WB-12 | Use generated, typed operations. | Every operation the app sends is generated from its documents, and a schema mismatch fails the build. | contract | M3 | planned |
| FR-WB-13 | Build the UI from one design system. | Components use semantic tokens only, generated from one source, and each has state tests and an accessibility check. | unit | M1 | done |
| FR-WB-14 | Serve the web app from AWS. | The app runs on Fargate behind the load balancer and deploys without failed requests. | staging | M7 | planned |
| FR-WB-16 | Install the CLI from npm. | `npx @ayenis/traverse` runs from the registry with provenance, with no runtime dependencies. | CI | M1 | done |
| FR-WB-15 | Offer a public demo. | A public URL loads the map and impact check with no sign-in. | e2e | M1 | done |

## AI assistant

The assistant only adds to deterministic results, through Amazon Bedrock.

| ID | Requirement | Acceptance check | Verified by | Milestone | Status |
|---|---|---|---|---|---|
| FR-AI-1 | Explain results. | Composition errors and impact results get a plain explanation that names the real fields involved. | integration | M5 | planned |
| FR-AI-2 | Suggest a safe change. | A suggested migration is shown only if it passes real composition. | integration | M5 | planned |
| FR-AI-3 | Draft an operation. | A drafted operation reaches the editor only if it validates against the schema. | integration | M5 | planned |
| FR-AI-4 | Work without AI. | With Bedrock blocked, every deterministic feature still works and the assistant says it's unavailable. | e2e | M5 | planned |

## Gateway

| ID | Requirement | Acceptance check | Verified by | Milestone | Status |
|---|---|---|---|---|---|
| FR-GW-1 | Serve the federated graph over HTTPS. | A persisted operation returns data from every subgraph; plain HTTP redirects to HTTPS. | e2e | M7 | planned |
| FR-GW-2 | Reject invalid JWTs. | Expired, wrong-audience and wrongly signed tokens are refused and reach no subgraph. A request with no token gets public data only. | e2e | M2 | done |
| FR-GW-3 | Keep serving if the Cosmo CDN is unavailable. | With the CDN blocked, running tasks and newly started tasks serve the last good configuration. | resilience | M10 | planned |
| FR-GW-4 | Limit request cost. | Operations over the depth or field limits, and bodies over the size limit, are rejected. | e2e | M2 | done |
| FR-GW-5 | Rate limit each client. | A client over its limit is rejected while other clients are unaffected. | e2e | M7 | planned |
| FR-GW-6 | Filter hostile traffic at the edge. | A request matching a managed WAF rule or the rate rule is blocked before it reaches the router. | staging | M6 | planned |
| FR-GW-7 | Report health accurately. | `/health/ready` fails while the router can't serve or is draining, and load balancer targets follow it. | staging | M7 | planned |
| FR-GW-8 | Drain before stopping. | On SIGTERM the task finishes in-flight requests before it exits, inside `stopTimeout`. | staging | M7 | planned |
| FR-GW-9 | Run a sandbox router for the workbench. | Reachable only from the web server, it returns query plans and runs free-form read operations. | e2e | M3 | planned |

## Subgraphs

| ID | Requirement | Acceptance check | Verified by | Milestone | Status |
|---|---|---|---|---|---|
| FR-SG-1 | Scope workspace data by user. | A token for one user can't read or change another user's workspace through any operation. | integration | M4 | planned |
| FR-SG-2 | `packages` serves npm data. | A real package's versions, licence, dependencies and downloads match the npm registry. | contract | M2 | done |
| FR-SG-3 | `repositories` serves GitHub data. | A real repository's stars, releases and owner match GitHub, and the token stays on the server. | contract | M2 | done |
| FR-SG-4 | `advisories` serves OSV data. | Advisories for a real package version match OSV. | contract | M2 | done |
| FR-SG-5 | Join data across subgraphs. | One operation returns a package, its repository and its advisories from three subgraphs. | e2e | M2 | done |
| FR-SG-6 | Degrade when a source fails. | If one upstream fails or rate limits, other fields still return, the error is clear, and repeat reads come from cache. | integration | M2 | done |
| FR-SG-7 | Every subgraph shares one kit. | A new subgraph gets health, auth context, logging and shutdown by supplying only a schema and resolvers. | unit | M2 | done |
| FR-SG-8 | Migrations are safe during rollout. | The previous release's tests pass against the migrated schema. | integration | M7 | planned |
| FR-SG-9 | `workspace` stores users' work. | Saved drafts and screen maps survive a restart. | integration | M4 | planned |
| FR-SG-10 | Notice upstream changes. | A scheduled check against the live sources fails if a recorded response no longer matches their shape. | CI | M2 | planned |

## Delivery

| ID | Requirement | Acceptance check | Verified by | Milestone | Status |
|---|---|---|---|---|---|
| FR-DP-1 | Block breaking schema changes. | A pull request removing a used field fails `wgc subgraph check`. | CI | M9 | planned |
| FR-DP-2 | Roll back failed deploys automatically. | A failing image returns to the previous task set with no manual step. | staging | M9 | planned |
| FR-DP-3 | Production needs staging proof and approval. | A production deploy can't start until staging smoke tests pass and an owner approves. | CI | M9 | planned |
| FR-DP-4 | Deploys use short-lived credentials. | The deploy role trusts only this repository and environment through OIDC. | infrastructure | M9 | planned |
| FR-DP-5 | Images are pinned and scanned. | Task definitions reference digests in ECR, and a failed scan stops the release. | infrastructure | M7 | planned |
| FR-DP-6 | Releases run in a safe order. | The pipeline migrates, deploys subgraphs, then publishes schemas, and stops at the first failure. | CI | M9 | planned |
| FR-DP-7 | Every pull request passes all quality gates. | A planted violation fails each gate, and CI is required on `main`. | CI | M0 | done |
| FR-DP-8 | Every change traces to a requirement. | A check fails on an unknown ID, a `done` requirement with no evidence, or a roadmap branch with no requirement. | unit | M0 | done |
| FR-DP-9 | Agents work from verified facts. | `AGENTS.md` and project skills define the sources of truth, and each Cosmo and AWS claim has a recorded source. | review | M0 | done |

## Observability

| ID | Requirement | Acceptance check | Verified by | Milestone | Status |
|---|---|---|---|---|---|
| FR-OB-1 | Trace every sampled request end to end. | One trace spans load balancer, router, subgraph and database. | staging | M8 | planned |
| FR-OB-2 | Export router metrics. | Request rate, errors and latency appear in CloudWatch and Studio. | staging | M8 | planned |
| FR-OB-3 | Show service health at a glance. | Dashboards cover traffic, latency, errors, saturation and data stores for each environment. | staging | M8 | planned |
| FR-OB-4 | Alert on user impact. | A forced failure raises its alarm and reaches the owner, and every alarm links to a runbook. | staging | M8 | planned |
| FR-OB-5 | Identify API clients. | Studio separates usage by client name and version. | staging | M8 | planned |
| FR-OB-6 | Write structured logs. | Every service logs JSON with a trace ID. | unit | M2 | done |

## Non-functional

| ID | Requirement | Acceptance check | Verified by | Milestone | Status |
|---|---|---|---|---|---|
| NFR-1 | Meet the availability and latency SLOs. | A load test at 2× expected peak stays within the targets in [SLOs](SLOS.md). | load | M10 | planned |
| NFR-2 | Deploy without failed requests. | A rolling deploy under load shows no 5xx responses. | load | M10 | planned |
| NFR-3 | Scale with demand. | Under rising load, tasks scale out before latency leaves its target, then scale back. | load | M10 | planned |
| NFR-4 | Survive the loss of an Availability Zone. | With one zone disrupted, the service stays within its availability target. | resilience | M10 | planned |
| NFR-5 | Recover data within targets. | A restore from backup meets the RPO and RTO in [SLOs](SLOS.md). | resilience | M10 | planned |
| NFR-6 | Keep costs visible. | Budget alerts exist before the first deployment, and the launch records a measured cost baseline. | infrastructure | M6 | planned |
| NFR-7 | Encrypt data at rest and in transit. | Stores use KMS encryption, and connections to data stores require TLS. | infrastructure | M6 | planned |
| NFR-8 | Operate from runbooks. | Each alarm's runbook has been followed once in staging. | staging | M11 | planned |
| NFR-9 | Meet WCAG 2.2 AA. | axe finds no violations on any route, every flow works by keyboard, and token contrast pairs pass in both themes. | e2e | M3 | planned |
| NFR-10 | Scale with the user's font size. | Styles use rem, em and % only, and a check rejects `px`. | CI | M1 | done |
| NFR-11 | Load quickly. | Largest Contentful Paint stays under 2.5 seconds at the 75th percentile on staging. | load | M10 | planned |
| NFR-12 | Stay responsive during composition. | Composing a real graph causes no main-thread task over 200 ms. | e2e | M1 | done |

## Guardrails

Guardrails are enforced by tests or policy, never by convention alone.

| ID | Requirement | Acceptance check | Verified by | Milestone | Status |
|---|---|---|---|---|---|
| GR-1 | The public production router never enables dev mode, playground, introspection, query plans or wildcard CORS. | A test parses the production router config and fails on each setting, proven with a planted violation of each. | unit | M2 | done |
| GR-2 | The public production router runs persisted operations only. | A non-persisted operation is rejected. | e2e | M2 | done |
| GR-3 | The user ID comes from the verified JWT, never client input. | No operation accepts a user ID, and a forged header has no effect. | integration | M4 | planned |
| GR-4 | GraphQL variables, personal data and secrets never reach logs or telemetry. | Variables sent in a test request appear in no log, span or metric. | e2e | M8 | planned |
| GR-5 | No long-lived AWS keys anywhere. | A CDK test rejects IAM users and access keys, and CI holds no AWS secrets. | infrastructure | M6 | planned |
| GR-6 | All infrastructure comes from CDK. | Scheduled drift detection reports no differences. | infrastructure | M9 | planned |
| GR-7 | Breaking schema changes can't merge. | The schema check is a required status on `main`. | CI | M9 | planned |
| GR-8 | Production changes only through the approved pipeline. | Only the pipeline role can change production services. | infrastructure | M9 | planned |
| GR-9 | Browser code can't read auth tokens or secrets. | Tokens live in `HttpOnly`, `Secure` cookies, and the client bundle contains no secrets. | e2e | M3 | planned |
| GR-10 | Licensed design assets enter the repository only after their licence is confirmed. | A written record of the licence check exists before any Frox-derived file is merged. | review | M1 | done |
| GR-11 | The sandbox router is never reachable from the internet and can't run mutations. | A test finds no public route to it, and a mutation sent to it is rejected. | e2e | M3 | planned |
| GR-12 | Model output is shown only after validation. | An invalid suggestion or operation from the model never reaches the user. | integration | M5 | planned |
| GR-13 | User schemas and upstream text are data, never instructions. | An instruction planted in a schema comment or README doesn't change the assistant's behaviour. | integration | M5 | planned |
| GR-14 | Prompts carry no tokens or personal data, and aren't logged. | A test inspects each prompt and the logs for planted secrets. | integration | M5 | planned |
| GR-15 | AI use is bounded. | Calls over the per-session limit are refused, and a spend alarm exists before the first call. | integration | M5 | planned |
| GR-16 | Maintainer emails are never stored, shown or sent to a model. | A real npm response's emails appear in no field, row or prompt. | integration | M2 | done |
