# Data privacy

Traverse serves real public data about open-source packages, and stores users' own saved work.

## What's stored

| Data | Location | Retention |
|---|---|---|
| Saved workspaces: schema drafts and screen maps | RDS Postgres | Until the user deletes them |
| User identity: Cognito subject and email | Cognito | Until the account is deleted |
| Parsed public npm, GitHub and OSV data, never raw responses, with personal fields dropped before storing | Redis, ElastiCache from M6 | Up to 2 days |
| Rate-limit counters | ElastiCache | Short-lived |
| Backups | RDS automated backups | 14 days |
| Logs | CloudWatch Logs | 30 days |
| Traces and metrics | CloudWatch, X-Ray | Service defaults |

Retention values are design targets, set in CDK during M6 and M8.

## What leaves AWS

| Data | Destination | Purpose |
|---|---|---|
| Subgraph schemas | Cosmo Cloud | Composition and registry |
| Operation names, timing and client names | Cosmo Cloud | Studio analytics |
| Sampled traces | Cosmo Cloud | Studio tracing |
| Schemas, operations and error text the user asks about | Amazon Bedrock, inside AWS | AI assistant |

GraphQL variables and response data must never be exported (GR-4). Exactly which attributes the router sends is reviewed in M8 against a real capture.

## Rules

- Logs and telemetry carry no personal data, tokens or secrets.
- Pasted or uploaded schemas stay in the browser unless the user saves them or asks the assistant about them.
- npm maintainer emails are dropped on read, and never stored, shown or sent to a model (GR-16).
- Test fixtures are recorded public responses, with personal fields removed. They hold no tokens or account IDs.
- All data is encrypted at rest and in transit (NFR-7).
