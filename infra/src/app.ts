import { Validations, type App } from "aws-cdk-lib";
// cdk-nag is CommonJS whose exports Node can't list, so its names come off the default export.
import nag from "cdk-nag";
import type { EnvironmentConfig } from "./config.ts";
import { acknowledgeReviewed } from "./nag-suppressions.ts";
import { DataStack } from "./data-stack.ts";
import { NetworkStack } from "./network-stack.ts";

const { AwsSolutionsChecks } = nag;

/**
 * Every environment's stacks, checked by cdk-nag as they synthesize. They name a Region and never
 * an account: a stack deploys into the account of whoever deploys it, so no account ID reaches the
 * code or a template, and synthesis looks nothing up, even where credentials are at hand.
 */
export const buildApp = (app: App, environments: readonly EnvironmentConfig[]) => {
  for (const config of environments) {
    const env = { region: config.region };
    // Both hold what can't be rebuilt from code: addresses others refer to, and data.
    const terminationProtection = true;
    const network = new NetworkStack(app, `traverse-${config.name}-network`, {
      env,
      config,
      terminationProtection,
    });
    const data = new DataStack(app, `traverse-${config.name}-data`, {
      env,
      config,
      terminationProtection,
      vpc: network.vpc,
    });
    acknowledgeReviewed(network, "network", config.name);
    acknowledgeReviewed(data, "data", config.name);
  }
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  return app;
};
