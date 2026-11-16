/** One request the router makes to a subgraph while it answers an operation. */
export interface RouteStep {
  id: number;
  subgraph: string;
  /** A root fetch starts from the operation. An entity fetch fills in fields of something already fetched. */
  kind: "root" | "entity";
  /** Where in the answer an entity fetch adds its fields. */
  path: string | null;
  /** The steps whose answers this one needs first. */
  after: number[];
  /** Steps in the same stage run at the same time. Stages run in order, from 0. */
  stage: number;
  /** What the router asks the subgraph. */
  query: string;
}

export interface Route {
  steps: RouteStep[];
}

/** What the server says about an operation: its route, why the router refused it, or nothing. */
export type RouteAnswer =
  | { kind: "route"; route: Route }
  | { kind: "refused"; messages: string[] }
  | { kind: "unavailable" };
