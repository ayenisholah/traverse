# Threat model

**Status:** Draft v1. Controls are planned until their requirement is `done`.

## Assets

- Users' saved workspaces in Postgres.
- The GitHub token used by the `repositories` subgraph.
- Signing trust: the JWT keys and the Cosmo router token.
- The deploy path: GitHub workflows, the OIDC role and images.
- Router configuration, which decides what the API exposes.

## Trust boundaries

1. The internet to the load balancer.
2. The router to subgraphs.
3. Subgraphs to data stores.
4. GitHub to AWS.
5. AWS to Cosmo Cloud, for config in and telemetry out.
6. The browser to the web server, over tRPC.
7. The web server to the sandbox router.
8. Subgraphs to npm, GitHub and OSV.
9. The web server to Amazon Bedrock.
10. A pull request to the Traverse Action, which reads its files and writes a public comment.

## Threats and controls

| Threat | Control | Requirement |
|---|---|---|
| A session cookie is read or forged | Each cookie holds one token, encrypted and authenticated with the server's key (JWE `dir`, `A256GCM`), `HttpOnly` and `SameSite=Lax`, and `Secure` with the `__Host-` prefix on HTTPS. A changed or expired one opens as no session, and each names its cookie, so one can't stand in for another. The session ends 12 hours after sign-in however often it's refreshed, and no access cookie outlives it (ADR 0020) | FR-WB-10, GR-9 |
| Someone else's sign-in is planted in a browser, or a code is replayed | The callback needs the `state` from the browser's own sealed flow cookie, compared in constant time, and the code is redeemed with the PKCE verifier only the server holds. The flow cookie lasts ten minutes and is cleared on every callback | FR-WB-10 |
| The callback's code appears in a load balancer's access log | Accepted: the code lasts five minutes, works once, and is useless without the PKCE verifier and client secret, which only the server holds (A-13) | FR-WB-10, GR-4 |
| Another site signs a user out | Sign-out is a POST that must come from the app's own origin | FR-WB-10 |
| A sign-in link sends the user elsewhere afterwards | `returnTo` must be a path on this app, or the user goes home | FR-WB-10 |
| A token that was signed out keeps working | Sign-out revokes the refresh token, but the routers verify access tokens themselves, so one already issued lasts until it expires. Accepted: the cookie holding it is cleared at once, and the app client's access token lifetime (planned for the CDK user pool) bounds the rest | FR-WB-10 |
| A user reads another user's workspace | The user is the verified token's subject (`requireUser`), and every statement carries `user_id = $1`. No operation takes a user ID, and `Workspace` has no entity key, so no plan can look one up by ID. Another user's workspace reads as none. Proven on the pinned router and Postgres | FR-SG-1, GR-3 |
| An ID token, or a token for another app, opens workspaces | The router checks the audience, which only a bound access token has (A-12), and the subgraph also requires `token_use: access` | GR-3 |
| The workspace subgraph runs with no way to check tokens | It refuses to start without `JWKS_URL`, `JWT_AUDIENCE` and `JWT_ISSUER` | GR-3 |
| The sandbox router reaches workspaces | It shares the execution config, so the schema is there, but the web server never sends it a token, so `requireUser` refuses every workspace field | GR-3, GR-11 |
| A user fills the database | At most 50 workspaces each, 20 drafts and 150,000 characters of SDL a workspace, limits on every other field, and the web server reads at most 512 KB of a request | FR-WB-11 |
| The database connection is read in transit | Plain connections only to this machine or a private service name; anything else must ask for `sslmode=verify-full`. Whether `pg` then verifies RDS's certificate is open (U-23) | NFR-7 |
| A forged user header reaches a subgraph | Subgraphs verify the token themselves, and security groups admit only the router | GR-3 |
| Arbitrary queries probe or overload the API | Persisted operations only; complexity, size and rate limits; WAF | GR-2, FR-GW-4, FR-GW-5, FR-GW-6 |
| Schema discovery by attackers | Introspection and playground off in production | GR-1 |
| Stolen or expired tokens | Short token lifetime; audience, expiry and signature checks | FR-GW-2 |
| A compromised router image | Digest pinning, ECR mirror, scanning | FR-DP-5 |
| Stolen deploy credentials | OIDC only, limited to this repository and environment | GR-5, FR-DP-4 |
| A malicious or faulty schema change | Required schema check and review | GR-7, FR-DP-1 |
| Sensitive data leaves through telemetry | Variables never exported; attributes reviewed | GR-4 |
| Cosmo Cloud is unavailable or compromised | S3 fallback config; only schema and telemetry cross the boundary | FR-GW-3 |
| Script injection steals a session | Tokens in `HttpOnly` cookies, Content Security Policy, React escaping | GR-9 |
| Cross-site request forgery | `SameSite` cookies and origin checks on mutations | GR-9 |
| Manual change weakens production | CDK only, drift detection, pipeline-only access | GR-6, GR-8 |
| A dependency is compromised | Lockfile, Dependabot, audit in CI, pinned actions | FR-DP-7 |
| Secrets committed to the public repository | Secret scanning in hooks and CI | FR-DP-7 |
| The web server's API is used to spend the graph's upstream budget | `package` runs one fixed persisted operation with a validated name. `route` runs a free-form query on the sandbox router: at most 10,000 characters of operation and 10,000 of variables, queries only, under the public router's complexity limits and a 10-second timeout. `checkManifest` reads at most 100 dependencies from a paste of up to 30,000 characters, skips anything that isn't an npm name with a registry range, asks the router about four at a time, stops starting new lookups after 30 seconds or once the browser's request is gone, and reports what it didn't reach as not checked. `packagePage` runs one persisted operation, whose version list can be npm's largest document (15-second timeout, C-58). A request body over 32 KB is refused before it's read whole, and batching is off. The server itself has no rate limit yet, so the server build must not face the internet before the WAF and router rate limits exist | FR-GW-5, FR-GW-6 |
| Server code or a server setting is bundled for the browser | Only route handlers and the start-up check may import `apps/web/src/server` (dependency-cruiser), no `NEXT_PUBLIC_` variable is read, and built chunks and pages are scanned | GR-9 |
| The router returns more than an operation asked for | The web server parses each answer against a strict schema tied to the generated type, and sends none of it on a mismatch | GR-16, FR-WB-12 |
| A free-form operation's answer carries data nobody checked, or a subgraph's text, to the browser | The web server keeps only the route built from the plan and drops the data. It passes on the router's messages only when the answer has no `data` key, which means the operation never ran (C-57) | GR-16, GR-13 |
| A pasted package.json is treated as instructions, or a crafted entry escapes the page | Read as JSON data: only `dependencies` and `devDependencies`, each name held to npm's format and each range to 256 characters and semver. Names, ranges and advisory text are shown as text, and links are built only from validated names, OSV IDs and GitHub addresses | GR-13, FR-WB-9 |
| The sandbox router is reached or abused | Bound to loopback locally and, planned for M7, a security group that admits only the web service. Mutations, subscriptions, WebSockets, batches and uploads are refused, with the public router's complexity limits. Its config may hold only settings that have a rule, its environment only three variables, and its access log keeps no part of a GET's operation. A rate limit is planned for M7 | GR-11 |
| A pull request's `traverse.json` or symlinks read files outside the repository into a public comment | Config paths and patterns are validated, matches outside the root are dropped, symlinks are resolved, and only GraphQL files can be schemas, because a parse error quotes the file | FR-WB-5 |
| Operation names or errors forge a comment or log line, hide content or mention people | All pull request text is escaped, including HTML, formatting and `@`, and line breaks and format characters are removed from every report. The marker can't be forged, and only `github-actions[bot]` comments are updated | FR-WB-5, GR-13 |
| A pull request runs code through the check | Source is parsed and never run, git runs with no shell, refs are resolved first, and `safe.bareRepository=explicit` stops a committed directory acting as a repository. Install scripts are off, and the Action's docs forbid `pull_request_target` | FR-WB-5, GR-13 |
| A pull request hides a break from the check | The base's patterns still apply, clashing fragments stop the check, symlinks and build directories stay in, a git fault can't read as a missing file, and `--strict` fails on anything unchecked | FR-WB-5, GR-7 |
| The comment token leaks | Only the comment step receives it, a fork's token is read-only, and this repository's checkout keeps no credential | FR-WB-5, GR-4 |
| A request exhausts a subgraph or blocks its shutdown | A 1 MB body limit, a parser token limit, only `POST /graphql` routed, and a forced close after a bounded wait | FR-SG-7 |
| A client's text or a secret reaches subgraph logs | Paths, aliases, messages and stacks aren't logged, and the shared logger drops sensitive fields itself | GR-4, FR-OB-6 |
| A subgraph trusts a claim it shouldn't | Tokens are verified again, with algorithm, audience, issuer, `exp` and `sub` checks, and `sub` must be a non-empty string | GR-3 |
| An upstream response carries personal data or hostile text | Every field is held to the format it should have, and OSV's prose `summary` is normalised, capped and replaced by the ID if it holds anything address-shaped, all as it's parsed, so a cache can't hold anything else. Redirects are refused, and responses are capped at 16 MB | GR-13, GR-16 |
| The GitHub token reaches the wrong place | It's sent only to GitHub's endpoint or a local service, refused redirects, and kept out of errors and logs | FR-SG-3 |
| A package names a private repository to read it through Traverse's token | Private repositories are treated as missing, whatever the token can read | FR-SG-3 |
| One request spends a source's budget | Identical calls share one upstream request. Each source has a concurrency limit and a queue of 500 that incoming requests share in turn: when it's full, a newcomer takes the place of the newest work from whichever request holds the most. A request that wants an answer another request has queued gets a place of its own, and the first place to come up fetches it for both. Fairness is per request, so many parallel requests are left to the router's limits. An operation may hold at most 500 entities across all its aliases. Retries stop after three tries or a 20-second deadline that counts queueing, a wait longer than 5 seconds isn't retried, and a 429 pauses that source for as long as it asks, up to a minute | FR-SG-6 |
| A vulnerable package looks safe | An empty list only comes from OSV's own empty answer: an unknown response shape, a bad version, a partial page set or a bad withdrawal date is an error. `fixedIn` must fall outside every affected range for this npm package, and OSV's address can't be changed to anything else | FR-SG-4 |
| The cache serves a wrong or stale advisory list | Keys name the question, including version, page and the source's origin, and carry a version for the stored shape. Every entry read back is checked against the same rules as on the way in, and a future time counts as a miss. OSV answers are never served stale: an outage is an error, not an old list | FR-SG-6, GR-16 |
| Redis is down or slow | Commands time out after 500 ms and count as a miss, and writes never hold up an answer. Plain `redis://` is only allowed to a local service | FR-SG-6, NFR-7 |
| A pasted schema contains hostile content | Parsed as data in a Web Worker, rendered escaped, and kept in the browser unless saved | FR-WB-2 |
| Upstream text carries script or instructions | Rendered escaped, and treated as data in prompts | GR-13 |
| Prompt injection steers the assistant | Output validated before it's shown, and it can't reach the graph or a mutation | GR-12, GR-13 |
| The assistant runs up cost | Per-session limits and a spend alarm | GR-15 |
| A GitHub token leaks | Read-only, held in Secrets Manager, used only on the server | FR-SG-3, GR-9 |
| An upstream outage or rate limit takes the app down | Caching, retries and clear partial results | FR-SG-6 |
| A deployment turns a banned router setting back on | The router reads its environment before the file (C-50), so `router/config.yaml` writes every risky setting out literally, including APQ, MCP, ConnectRPC, CORS patterns and the block's condition, and a test fails otherwise. Variables are expanded into the raw text (C-43), so the file may use only six known ones, and `findUnsafeRouterEnvironment` holds a deployment's whole environment to those, each in a strict format, with a single-file `CONFIG_PATH` (C-44). The e2e harness runs the router under that check. The file may also hold only settings that have a rule, so a key nobody named, such as a routing override, a second listener or a telemetry export, fails too, and its access log keeps no part of a GET's operation (C-55). Accepted: the log still keeps any other parameter a client adds to the address, because the router hides only named ones. The web app sends none, and a client that adds one chose to | GR-1, GR-2, GR-4 |
| A costly operation exhausts the graph | Persisted operations only, with depth, field, root field and alias limits enforced on them too, and a 1MB body cap (C-45, C-46) | FR-GW-4, GR-2 |

## Accepted risks

- A Region-wide AWS outage stops the service, because multi-Region failover is out of scope.
- Cosmo Cloud holds the schema and sampled telemetry. Traverse treats its schema as public.
- The Traverse Action reports on what a pull request contains. It can't see an operation moved outside every pattern, or a tag from an unrecognised package. In this repository a pull request also runs its own copy of the Action, so the check gates nothing until GR-7's required check exists.
- Bare URLs in a name stay clickable in a pull request comment.
- Subgraphs keep introspection on, because `_service` exposes their SDL anyway and only the router can reach them.
- A person spelling an address out in words in an advisory summary can't be detected. Summaries are curated vulnerability titles, and none of 309 real ones held an address.
- Advisories use the package name as given, so a representation sent straight to the subgraph with the wrong case gets an empty list. Through the router, the `packages` subgraph resolves the name first.
- The depth limit equals the deepest operation the schema allows, so no valid operation exceeds it today. The e2e suite proves the limit is enforced by lowering it on a second router.
- If a Redis host stops answering connection attempts, a command can wait up to its 1-second connect timeout before counting as a miss.
