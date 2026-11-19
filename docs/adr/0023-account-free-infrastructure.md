# 0023: Keep accounts out of the infrastructure code, and accept cdk-nag findings only from one list

**Status:** Accepted

## Context

M6 starts the `infra/` workspace (ADR 0003). Account setup isn't done, and the account the local AWS CLI user reaches is shared with other projects. The owner decided on 2026-11-19 to build M6 locally, without deploying, and that Traverse gets its own account later. The repository is public, so no account ID may be in it. GR-5 asks for a CDK test that rejects IAM users and access keys, and M6's exit asks for `cdk-nag` with no unreviewed suppressions.

## Decision

- **No account in the code.** Stacks name a Region and never an account, so they deploy into the account of whoever deploys them (A-19). Nothing needs a context lookup: zones are listed in config, and later imports go by attributes. `npm run synth:infra` runs `cdk synth --lookups=false --strict`, so a lookup or a warning fails it, with or without credentials. No `cdk.context.json` is committed, because it would hold an account ID.
- **Environment config.** `infra/src/config.ts` is the only place staging and production differ, held to a strict zod schema. It has no account and no email field.
- **cdk-nag 3 as a validation plugin.** The AWS Solutions checks run on every synthesis, in tests and in CI, and any finding fails it (A-20).
- **One list of accepted findings.** `infra/src/nag-suppressions.ts` lists every acknowledged finding with its construct path and reason. An entry whose construct is gone fails synthesis, and a test fails on any acknowledgement made outside the list. Only aws-cdk-lib's own acknowledgements of its template linter are exempt.
- **Guardrails over the whole app.** `infra/test/guardrails.test.ts` runs on every stack the app builds, so a new stack is covered without a new test: no IAM user or access key (GR-5), no account ID in a template, no AWS keys in CI.

## Consequences

- `cdk diff` and deployments need the target account's credentials. Bootstrapping is per account and Region.
- A construct that needs a concrete account at synthesis can't be used. Anything that would look something up must take it from config instead.
- The CDK CLI shows the deploying account when it runs. That output stays on the machine running it.
