# 0022: Reach the model only through a validated, fenced, counted port

**Status:** Accepted

## Context

M5 adds an assistant on Amazon Bedrock (ADR 0012). A model can be wrong, and the text it reads (user schemas, operations, error messages, upstream README text) can carry instructions meant for it. GR-12 to GR-15 require that nothing unvalidated is shown, that planted instructions change nothing, that prompts carry no tokens or personal data and aren't logged, and that use is bounded.

U-19 (which Claude model, in which Region, at what cost) and account setup are still open, and the local AWS user must stay read-only. The owner chose on 2026-11-19 to build M5 against a local stand-in, and to offer the assistant to signed-in users only.

## Decision

- **One port.** Every call goes through `createAssistant` in `apps/web/src/server/assistant`, which checks the size, takes the user's limit, and only then scrubs, builds the prompt and asks a `Model`, so a refused call costs nothing more. A caller gets a value that parsed against its task's zod schema, or a fixed outcome: `limit`, `too-large` or `unavailable`. It never gets the model's text.
- **Structured output only.** The Bedrock model calls Converse with one tool whose input schema is the task's schema (`z.toJSONSchema`), forced with `toolChoice`, at temperature 0 with `maxTokens` set (A-15). The tool's input is parsed again before use, so another tool, free text or an extra field is `invalid`. Every answer schema must be strict all the way down, or `createAssistant` refuses it, because a loose object would quietly trim extra fields rather than refuse them. The model has no other tool and no way to act.
- **Data is fenced.** App-written text is a `Fixed` string, made only by the `fixed` template tag, which can't take `${...}`, so user text can't reach the instructions by accident. Untrusted text goes only inside data blocks marked with a random boundary, which the model is told is material and never instructions, and which the text can't close or rebuild (GR-13). Block names must match a fixed pattern. Every item is scrubbed first (GR-14, GR-16): JWTs, bearer and basic credentials, GitHub tokens, AWS keys, private keys, and emails, after folding look-alike characters and removing invisible ones. Every pattern is bounded so no input can make it slow. The size is capped before and after scrubbing.
- **Validation per task.** Each feature validates the parsed answer against the real thing before showing it: the fields an explanation names must exist, a suggestion must compose and break less, and a drafted operation must validate against the schema (GR-12).
- **Counted per user.** Only a signed-in user can ask. Calls are counted per user and in all, per UTC day, in Redis, keyed by a digest of the user's subject. A call counts against everyone only once the user's own limit lets it through, so one user can't use up the day. If the counter can't be reached, nobody may call (GR-15).
- **The user's subject** comes from the access token the server holds. That token came from the user pool's token endpoint to this server over TLS, and lives in a cookie only this server can seal, so the browser can't have written it. It is used only to key the limit; the workspace subgraph still verifies every token itself (GR-3).
- **Nothing is logged:** no prompt, no answer, no input. Failures keep only a fixed reason code.
- **Credentials.** In a deployment, the SDK's default chain finds the ECS task role (GR-5). A local run points `AI_ENDPOINT` at the stand-in and signs with fixed test values, so the machine's own AWS credentials are never read (A-17).
- **The stand-in** (`router/test/support/model-stub.ts`) speaks Converse over cleartext HTTP/2, as the SDK always does (A-18). It replays scripted answers, including wrong and hostile ones, and records each prompt for tests.

Rejected: free-text answers parsed afterwards (a model could smuggle anything into them); calling Bedrock from the browser (it would need credentials there); a per-cookie limit (a visitor could reset it); Bedrock Guardrails as the injection defence (it filters content but doesn't make output valid, and the boundary and validation hold without it).

## Consequences

- A hostile or wrong answer can at worst be refused. What's shown has passed the same checks as the deterministic features.
- Whether the real model respects the boundary is still a model property. `scripts/eval-assistant.ts`, planned for when account setup is done, runs the GR-13 fixtures against it, and FR-AI-1 to FR-AI-3 and GR-13 stay `partial` until then.
- The assistant needs Redis in a deployment, which M6 provides as ElastiCache.
- The spend alarm GR-15 also asks for needs AWS, and is planned with the account's budget.
