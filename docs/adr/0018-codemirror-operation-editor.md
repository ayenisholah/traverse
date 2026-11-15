# 0018: Edit operations in CodeMirror 6, not Monaco

**Status:** Accepted

## Context

`SPEC.md` listed Monaco for the `/operations` editor (FR-WB-7). Nothing uses it yet: the impact check shipped with a plain `<textarea>`. Monaco is a large dependency, its React wrapper loads the editor from a CDN by default, and NFR-9 needs every route to work by keyboard and pass axe in both themes. The owner was asked on 2026-11-16 (D-1 in the [M3 plan](../plans/m3-live-routes.md)).

## Decision

Use CodeMirror 6 for the operation editor. It's bundled with the app, so nothing loads from a third party at run time.

Rejected:

- **Monaco**, for its weight, the CDN default and the accessibility work.
- **A plain `<textarea>`**, as on `/impact`. It's the most accessible, but an operation editor without highlighting or completion serves FR-WB-7 poorly.

## Consequences

- `SPEC.md`'s stack lists CodeMirror 6 in place of Monaco.
- `feat/route-view` pins the CodeMirror packages and records their versions and behaviour in verified facts before relying on them. Its keyboard and screen-reader behaviour is unproven here until that branch's Playwright and axe tests pass.
- The editor must not trap the Tab key without a documented way out.
- `/impact` keeps its `<textarea>`. Moving it to CodeMirror would be a separate change with its own requirement.
