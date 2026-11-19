# 0021: Keep workspaces in Postgres through `pg`, with plain SQL migrations and no entity key

**Status:** Accepted

## Context

FR-WB-11 saves a signed-in user's schema drafts, operations and screen map, FR-SG-9 keeps them across a restart, and FR-SG-1 and GR-3 keep each user to their own. `SPEC.md` already chose RDS Postgres, which arrives with M6's data stack; until then the subgraph runs against Postgres in Docker. M7's migration task (FR-SG-8) runs migrations before the subgraphs deploy, so they need to be something it can run alone.

`SPEC.md` gave `Workspace` an entity key. Nothing else in the graph refers to a workspace, and a key would add an `_entities` lookup by ID that a query plan could reach.

## Decision

- The `workspace` subgraph talks to Postgres through `pg` 8.23.1, with parameters for every value and `user_id = $1` in every statement, the verified subject from `requireUser`.
- Migrations are numbered SQL files in `subgraphs/workspace/migrations`, applied in name order by a small runner, each in a transaction, under an advisory lock, and recorded in `schema_migrations`. `src/migrate-main.ts` is the entry point the M7 task runs.
- `Workspace` has no `@key`. A user reaches a workspace only through `workspaces` and `workspace(id)`, both scoped to them.
- Inputs are limited in the subgraph (50 workspaces a user, 20 drafts, 150,000 characters of SDL, and limits on the rest), and the web server bounds what it forwards.

Rejected: an ORM or query builder (four statements don't need one, and it would hide the `user_id` filter this design relies on); a migration framework (it would add a dependency and its own conventions to M7's task for one table); keeping the entity key (an extra path to a user's data, for no consumer).

## Consequences

- A review can check every statement for the user filter in one short file.
- Schema changes are hand-written SQL, applied forward only. A rollback is a new migration.
- TLS to RDS depends on U-23, which M6 answers before the first deploy.
