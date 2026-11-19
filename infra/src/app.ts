import { Validations, type App } from "aws-cdk-lib";
// cdk-nag is CommonJS whose exports Node can't list, so its names come off the default export.
import nag from "cdk-nag";
import type { EnvironmentConfig } from "./config.ts";
import { acknowledgeReviewed } from "./nag-suppressions.ts";
import { NetworkStack } from "./network-stack.ts";

const { AwsSolutionsChecks } = nag;

/**
 * Every environment's stacks, checked by cdk-nag as they synthesize. The account is the
 * deployment's, never the code's, so with none the stacks synthesize account-agnostic and look
 * nothing up.
 */
export const buildApp = (
  app: App,
  environments: readonly EnvironmentConfig[],
  account?: string,
) => {
  for (const config of environments) {
    const env = { account, region: config.region };
    const network = new NetworkStack(app, `traverse-${config.name}-network`, { env, config });
    acknowledgeReviewed(network, "network");
  }
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  return app;
};
