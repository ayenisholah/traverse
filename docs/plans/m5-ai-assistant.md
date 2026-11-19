# M5: AI assistant

**Needs:** [account setup](account-setup.md) and an answer to U-19 for the real model. The owner chose on 2026-11-19 to build it first against a local stand-in for Bedrock, for signed-in users only (ADR 0022).

**Outcome:** Amazon Bedrock explains results and proposes validated changes. Every other feature works with it off.

## Work

1. `feat/bedrock-client`: server-side client through the task role, with limits, prompt rules and failure handling.
2. `feat/ai-explain`: plain explanations of composition errors and impact results.
3. `feat/ai-suggest`: safe migrations, checked by real composition before they're shown.
4. `feat/ai-draft`: operations from a description, validated against the schema.

## Exit

- An invalid suggestion is never shown.
- An instruction planted in a schema comment or README changes nothing.
- With Bedrock blocked, all deterministic results still work.

## Status

Built on 2026-11-19 against a local stand-in for Bedrock. The exit checks pass locally: an invalid suggestion or drafted operation is never shown, planted instructions travel only as fenced data and a hostile answer can't pass validation, and with the model blocked every deterministic result still works. Left for AWS: U-19, the task role's Bedrock permission, the spend alarm (GR-15) and the real-model evaluation (`scripts/eval-assistant.ts`, planned), which moves FR-AI-1 to FR-AI-3 and GR-13 to `done`.

