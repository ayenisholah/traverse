import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { BudgetStack, BUDGETS_REGION } from "../src/budget-stack.ts";
import { ACCOUNT_BUDGET, accountBudget } from "../src/config.ts";
import { newApp } from "./support/app.ts";

const template = Template.fromStack(
  new BudgetStack(newApp(), "budgets", { env: { region: BUDGETS_REGION }, budget: ACCOUNT_BUDGET }),
);
const budgets = Object.values(template.findResources("AWS::Budgets::Budget"));
const alertKey = { "Fn::GetAtt": [Match.stringLikeRegexp("^AlertKey"), "Arn"] };

describe("the budget stack", () => {
  it("[NFR-6] lives in us-east-1, where CloudFormation has budgets", () => {
    expect(BUDGETS_REGION).toBe("us-east-1");
  });

  it("[NFR-6] holds the account's budgets once, for every environment", () => {
    expect(accountBudget.safeParse({ ...ACCOUNT_BUDGET, monthlyUsd: 0 }).success).toBe(false);
    expect(budgets).toHaveLength(2);
    template.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: {
        BudgetName: "traverse-everything",
        BudgetType: "COST",
        TimeUnit: "MONTHLY",
        BudgetLimit: { Amount: ACCOUNT_BUDGET.monthlyUsd, Unit: "USD" },
      },
    });
  });

  it("[GR-15] budgets for Bedrock alone", () => {
    template.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({
        BudgetName: "traverse-bedrock",
        BudgetLimit: { Amount: ACCOUNT_BUDGET.bedrockMonthlyUsd, Unit: "USD" },
        CostFilters: { Service: ["Amazon Bedrock"] },
      }),
    });
  });

  it("[NFR-6] alerts at 80% and 100% spent, and at 100% forecast", () => {
    const subscribers = [
      { SubscriptionType: "SNS", Address: { Ref: expect.stringMatching(/^Alerts/) as string } },
    ];
    const notification = (NotificationType: string, Threshold: number) => ({
      Notification: {
        NotificationType,
        Threshold,
        ComparisonOperator: "GREATER_THAN",
        ThresholdType: "PERCENTAGE",
      },
      Subscribers: subscribers,
    });
    for (const budget of budgets) {
      expect(budget.Properties.NotificationsWithSubscribers).toEqual([
        notification("ACTUAL", 80),
        notification("ACTUAL", 100),
        notification("FORECASTED", 100),
      ]);
    }
  });

  it("[NFR-6] sends alerts through an encrypted topic only this account's budgets use", () => {
    template.hasResourceProperties("AWS::SNS::Topic", { KmsMasterKeyId: alertKey });
    const fromBudgets = {
      Principal: { Service: "budgets.amazonaws.com" },
      Condition: { StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } } },
    };
    template.hasResourceProperties("AWS::SNS::TopicPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ ...fromBudgets, Effect: "Allow", Action: "sns:Publish" }),
        ]),
      },
    });
    // Without this, Budgets can't publish to the encrypted topic and no alert ever arrives.
    template.hasResourceProperties("AWS::KMS::Key", {
      KeyPolicy: {
        Statement: Match.arrayWith([
          Match.objectLike({
            ...fromBudgets,
            Effect: "Allow",
            Action: ["kms:Decrypt", "kms:GenerateDataKey*"],
          }),
        ]),
      },
    });
  });

  it("[GR-4] takes the alert address at deploy time, and doesn't echo it", () => {
    template.hasParameter("AlertEmail", { Type: "String", NoEcho: true });
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: { Ref: "AlertEmail" },
    });
  });
});
