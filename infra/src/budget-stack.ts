import { CfnParameter, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";
import type { AccountBudget } from "./config.ts";

/** AWS Budgets lives in us-east-1: CloudFormation has no budget resource in eu-north-1 (A-30). */
export const BUDGETS_REGION = "us-east-1";

export interface BudgetStackProps extends StackProps {
  readonly budget: AccountBudget;
}

/**
 * The account's budgets, one set for every environment, since they share the account; other
 * stacks depend on this one, so it deploys before anything else costs money (NFR-6). The alert address is a
 * parameter given at deploy time, so no one's email is in this public code.
 */
export class BudgetStack extends Stack {
  /**
   * A budget for everything and one for Bedrock alone, alerting at 80% and 100% spent and at
   * 100% forecast, through an encrypted topic only AWS Budgets in this account may publish to.
   */
  constructor(scope: Construct, id: string, props: BudgetStackProps) {
    super(scope, id, props);
    const { budget } = props;
    const alertEmail = new CfnParameter(this, "AlertEmail", {
      type: "String",
      description: "Who budget alerts go to",
      minLength: 3,
      // Kept out of the console and the stack's description; the subscription still shows it.
      noEcho: true,
    }).valueAsString;
    const budgets = new ServicePrincipal("budgets.amazonaws.com");
    const key = new Key(this, "AlertKey", {
      description: "Encrypts budget alerts",
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    key.grant(
      budgets.withConditions({ StringEquals: { "aws:SourceAccount": this.account } }),
      "kms:GenerateDataKey*",
      "kms:Decrypt",
    );
    const topic = new Topic(this, "Alerts", { masterKey: key, enforceSSL: true });
    topic.addToResourcePolicy(
      new PolicyStatement({
        principals: [budgets],
        actions: ["sns:Publish"],
        resources: [topic.topicArn],
        conditions: { StringEquals: { "aws:SourceAccount": this.account } },
      }),
    );
    topic.addSubscription(new EmailSubscription(alertEmail));
    const subscribers = [{ subscriptionType: "SNS", address: topic.topicArn }];
    const notifications = [
      { notificationType: "ACTUAL", threshold: 80 },
      // A forecast needs weeks of history, so a new account relies on these two at first.
      { notificationType: "ACTUAL", threshold: 100 },
      { notificationType: "FORECASTED", threshold: 100 },
    ].map((notification) => ({
      notification: {
        ...notification,
        comparisonOperator: "GREATER_THAN",
        thresholdType: "PERCENTAGE",
      },
      subscribers,
    }));
    for (const [id, amount, costFilters] of [
      ["Everything", budget.monthlyUsd, undefined],
      // GR-15's spend alarm. Whether Claude's charges land under this name is U-25.
      ["Bedrock", budget.bedrockMonthlyUsd, { Service: ["Amazon Bedrock"] }],
    ] as const) {
      new CfnBudget(this, `${id}Budget`, {
        budget: {
          budgetName: `traverse-${id.toLowerCase()}`,
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount, unit: "USD" },
          costFilters,
        },
        notificationsWithSubscribers: notifications,
      });
    }
  }
}
