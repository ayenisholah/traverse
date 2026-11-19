import { Validations, type App } from "aws-cdk-lib";
// cdk-nag is CommonJS whose exports Node can't list, so its names come off the default export.
import nag from "cdk-nag";
import { ACCOUNT_BUDGET, type EnvironmentConfig } from "./config.ts";
import { acknowledgeReviewed } from "./nag-suppressions.ts";
import { BudgetStack, BUDGETS_REGION } from "./budget-stack.ts";
import { DataStack } from "./data-stack.ts";
import { EdgeStack } from "./edge-stack.ts";
import { NetworkStack } from "./network-stack.ts";

const { AwsSolutionsChecks } = nag;

/**
 * Every environment's stacks, checked by cdk-nag as they synthesize. They name a Region and never
 * an account: a stack deploys into the account of whoever deploys it, so no account ID reaches the
 * code or a template, and synthesis looks nothing up, even where credentials are at hand.
 */
export const buildApp = (app: App, environments: readonly EnvironmentConfig[]) => {
  // Once for the account every environment shares, and first: every other stack waits for it, so
  // alerts exist before anything costs money (NFR-6).
  const budgets = new BudgetStack(app, "traverse-budgets", {
    env: { region: BUDGETS_REGION },
    budget: ACCOUNT_BUDGET,
    // Losing it would silence the alerts.
    terminationProtection: true,
  });
  for (const config of environments) {
    const env = { region: config.region };
    // Every stack holds something that can't be rebuilt from code: addresses others refer to,
    // data or users.
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
    const edge = new EdgeStack(app, `traverse-${config.name}-edge`, {
      env,
      config,
      // It holds the user pool, whose users can't be rebuilt from code.
      terminationProtection,
      vpc: network.vpc,
    });
    for (const stack of [network, data, edge]) stack.addDependency(budgets);
    acknowledgeReviewed(network, "network", config.name);
    acknowledgeReviewed(data, "data", config.name);
    acknowledgeReviewed(edge, "edge", config.name);
  }
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  return app;
};
