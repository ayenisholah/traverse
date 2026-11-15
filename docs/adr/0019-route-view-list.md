# 0019: Show a route as an ordered list with an SVG outline, not a React Flow canvas

**Status:** Accepted

## Context

`SPEC.md` listed React Flow for the route view (FR-WB-7). A query plan is a small tree of fetches, and the requirement is that the view's subgraphs and fetch order match the router's plan. The graph map already shipped as a keyboard-first list instead of a canvas, and NFR-9 applies to every route. The owner was asked on 2026-11-16 (D-2 in the [M3 plan](../plans/m3-live-routes.md)).

## Decision

Show the route as an ordered, keyboard-navigable list of fetches, with an SVG outline of the tree drawn by the app. The list carries the content, and the outline is a picture of the same data.

Rejected: **a React Flow canvas**. A pannable node canvas adds a dependency and accessibility work for a tree this small, and the fetch order reads more plainly as a list.

## Consequences

- `SPEC.md`'s stack no longer lists React Flow, and no canvas library is added.
- The route model, from plan JSON to ordered fetches, is plain data with unit tests, and both the list and the outline render from it.
- The outline needs a text alternative, or to be hidden from assistive technology, because the list already says the same thing.
- A plan too large to read as a list would reopen this decision. The depth limit of 3 on the public router (C-45) keeps plans small today.
