import { Validations, type Stack } from "aws-cdk-lib";

type StackKind = "network";

export interface ReviewedAcknowledgement {
  readonly stack: StackKind;
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
export const REVIEWED_ACKNOWLEDGEMENTS: readonly ReviewedAcknowledgement[] = [];

export const acknowledgeReviewed = (
  stack: Stack,
  kind: StackKind,
  reviewed: readonly ReviewedAcknowledgement[] = REVIEWED_ACKNOWLEDGEMENTS,
) => {
  for (const { path, id, reason } of reviewed.filter((entry) => entry.stack === kind)) {
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
