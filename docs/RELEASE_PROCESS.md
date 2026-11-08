# Release process

## Environments

| Environment | Purpose | Status |
|---|---|---|
| Local | The real graph in Docker, behind the pinned router image (`npm run test:router`) | In use |
| CI | Throwaway services on each run | In use |
| Staging | Proving releases | Planned, M7 |
| Production | Live traffic | Planned, M11 |

## Change flow

Feature branch → pull request → green checks → rebase merge. See [contributing](../CONTRIBUTING.md).

From M9, merging to `main` deploys staging and runs smoke tests. Production waits for an owner's approval.

## Release order

1. Run migrations as a one-off ECS task.
2. Deploy subgraphs.
3. Publish schemas with `wgc subgraph publish`.

The pipeline stops at the first failure.

## Versioning

`release-please` reads Conventional Commits on `main` and maintains a release pull request with the version and changelog.

GitHub doesn't run workflows for pull requests that `GITHUB_TOKEN` opens or updates, so a release pull request has no checks. Close and reopen it to run CI, and do so again after release-please updates it. A manual `gh workflow run` isn't enough: its result attaches to the commit but not to the pull request.

## Database migrations

Use expand and contract, so old and new code can run during a deploy:

1. **Expand:** add new columns or tables, nullable or with defaults.
2. **Migrate:** deploy code that writes both forms, then backfill.
3. **Contract:** remove the old form in a later release.

## Schema changes

Add new fields first. Before removing a field, deprecate it and confirm through Studio that clients have stopped using it.

## Router upgrades

Upgrades change the pinned digest and [verified facts](VERIFIED_FACTS.md) in one pull request, and run through staging like any release.

## Rollback

- **Services:** ECS deployment circuit breakers and alarms return to the previous task set.
- **Schema:** republish the previous subgraph schema.
- **Database:** migrations roll forward. Expand and contract keeps the previous release working.
