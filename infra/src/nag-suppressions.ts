import { Validations, type Stack } from "aws-cdk-lib";

import type { EnvironmentConfig } from "./config.ts";

type StackKind = "network" | "data";

export interface ReviewedAcknowledgement {
  readonly stack: StackKind;
  /** Where the finding is accepted, when it isn't everywhere: a difference config decides. */
  readonly only?: EnvironmentConfig["name"];
  /** The construct's path inside its stack. */
  readonly path: string;
  /** A cdk-nag rule, with the finding in brackets where the rule reports several. */
  readonly id: string;
  readonly reason: string;
}

/**
 * Every cdk-nag finding this project accepts, each with its reason. Nothing is acknowledged
 * anywhere else, and a test fails on an acknowledgement that isn't in this list.
 */
export const REVIEWED_ACKNOWLEDGEMENTS: readonly ReviewedAcknowledgement[] = [
  {
    stack: "data",
    only: "staging",
    path: "/Database/Resource",
    id: "AwsSolutions-RDS3",
    reason:
      "Staging is the same stacks, smaller: one zone for the database (SPEC). Production is Multi-AZ, which the config requires",
  },
  {
    stack: "data",
    only: "staging",
    path: "/Cache",
    id: "AwsSolutions-AEC4",
    reason:
      "Staging runs one cache node (SPEC). Production runs a replica in another zone, which the config requires",
  },
  {
    stack: "data",
    path: "/Database/Resource",
    id: "AwsSolutions-RDS11",
    reason:
      "Only the data clients security group can reach the database, in subnets with no route out; another port number would hide nothing from what can reach it",
  },
  {
    stack: "data",
    path: "/Database/Secret/Resource",
    id: "AwsSolutions-SMG4",
    reason:
      "Rotation needs the workspace subgraph to read the login from Secrets Manager rather than its environment, which M7's services do. Until then a rotated password would cut it off",
  },
  {
    stack: "data",
    path: "/CacheAuth/Resource",
    id: "AwsSolutions-SMG4",
    reason:
      "Rotating a Valkey AUTH token means changing the replication group with a ROTATE strategy, which needs a rotation function M7's services can follow. Until then a new token would cut clients off",
  },
];

export const acknowledgeReviewed = (
  stack: Stack,
  kind: StackKind,
  environment: EnvironmentConfig["name"],
  reviewed: readonly ReviewedAcknowledgement[] = REVIEWED_ACKNOWLEDGEMENTS,
) => {
  const applies = (entry: ReviewedAcknowledgement) =>
    entry.stack === kind && (entry.only === undefined || entry.only === environment);
  for (const { path, id, reason } of reviewed.filter(applies)) {
    // A namespaced ID (`AwsSolutions::…`) is matched by aws-cdk-lib rather than cdk-nag, and turns
    // every warning-level finding from failing synthesis into passing it.
    if (id.includes("::")) throw new Error(`acknowledge ${id} by its bare rule ID`);
    const target = stack.node
      .findAll()
      .find(({ node }) => node.path === `${stack.node.path}${path}`);
    // A stale entry fails, so the list can't outlive what it was written for.
    if (target === undefined) throw new Error(`no construct at ${path} in ${stack.stackName}`);
    Validations.of(target).acknowledge({ id, reason });
  }
};
