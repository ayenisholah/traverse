# M4: Accounts and saved workspaces

**Needs:** [account setup](account-setup.md) to prove sign-in against a real user pool. The owner chose on 2026-11-18 to build both branches first, against a local issuer and Postgres in Docker.

**Outcome:** a signed-in user can save schema drafts and screen maps. The rest of the app still works with no account.

## Work

1. `feat/web-auth`: Cognito code flow with PKCE, a server-side session, `HttpOnly` cookies, and a local issuer for development and tests.
2. `feat/workspace-subgraph`: saved workspaces in Postgres, scoped by the verified user ID. It adds a shared `requireUser` helper to `packages/subgraph-kit`, and refuses to start without auth settings. U-22 is answered first.

## Exit

- One user can't reach another's workspace through any operation.
- A forged header has no effect.
