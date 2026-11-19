import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ENVIRONMENTS } from "../src/config.ts";
import { NetworkStack } from "../src/network-stack.ts";

interface Resource {
  readonly Properties: Readonly<Record<string, unknown>>;
}
import { newApp } from "./support/app.ts";

const templates = new Map(
  ENVIRONMENTS.map((config) => {
    const stack = new NetworkStack(newApp(), "network", {
      config,
      env: { region: config.region },
    });
    return [config.name, Template.fromStack(stack)];
  }),
);
const each = [...templates.entries()];

describe("the network stack", () => {
  it.each(each)("[NFR-7] spreads %s's subnets over three zones", (_, template) => {
    const subnets = template.findResources("AWS::EC2::Subnet");
    const zones = new Set(
      Object.values(subnets).map((subnet) =>
        String((subnet as Resource).Properties.AvailabilityZone),
      ),
    );

    expect(Object.keys(subnets)).toHaveLength(9);
    expect([...zones].sort()).toEqual(["eu-north-1a", "eu-north-1b", "eu-north-1c"]);
  });

  it("[NFR-7] runs one NAT gateway on staging and one a zone in production", () => {
    templates.get("staging")?.resourceCountIs("AWS::EC2::NatGateway", 1);
    templates.get("production")?.resourceCountIs("AWS::EC2::NatGateway", 3);
  });

  it.each(each)(
    "[NFR-7] gives %s's data subnets no route out, as the others have",
    (_, template) => {
      const tables = Object.entries(template.findResources("AWS::EC2::RouteTable"));
      const tablesOf = (subnets: string) =>
        tables
          .filter(([, table]) =>
            JSON.stringify((table as Resource).Properties.Tags).includes(subnets),
          )
          .map(([id]) => id);
      const routesFrom = (id: string) =>
        Object.keys(
          template.findResources("AWS::EC2::Route", { Properties: { RouteTableId: { Ref: id } } }),
        ).length;

      expect(tablesOf("dataSubnet").map(routesFrom)).toEqual([0, 0, 0]);
      expect(tablesOf("servicesSubnet").map(routesFrom)).toEqual([1, 1, 1]);
    },
  );

  it.each(each)("[NFR-7] keeps %s's flow logs, encrypted, for a set time", (name, template) => {
    template.hasResourceProperties("AWS::EC2::FlowLog", {
      TrafficType: "ALL",
      LogDestinationType: "cloud-watch-logs",
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      KmsKeyId: Match.anyValue(),
      RetentionInDays: name === "staging" ? 30 : 365,
    });
    template.hasResourceProperties("AWS::KMS::Key", { EnableKeyRotation: true });
  });

  it.each(each)(
    "[NFR-7] lets only %s's log service use the key, for this account's logs",
    (_, template) => {
      template.hasResourceProperties("AWS::KMS::Key", {
        KeyPolicy: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: { Service: "logs.eu-north-1.amazonaws.com" },
              Condition: {
                ArnLike: {
                  // Log group ARNs put a colon before the name, never a slash.
                  "kms:EncryptionContext:aws:logs:arn": {
                    "Fn::Join": [
                      "",
                      ["arn:aws:logs:eu-north-1:", { Ref: "AWS::AccountId" }, ":log-group:*"],
                    ],
                  },
                },
              },
            }),
          ]),
        },
      });
    },
  );

  it.each(each)(
    "[NFR-7] reaches S3 in %s through a gateway endpoint, but not from data subnets",
    (_, template) => {
      const [endpoint] = Object.values(template.findResources("AWS::EC2::VPCEndpoint")) as [
        Resource,
      ];
      const tables = (endpoint.Properties.RouteTableIds as { Ref: string }[]).map(({ Ref }) => Ref);

      expect(endpoint.Properties.VpcEndpointType).toBe("Gateway");
      expect(tables).toHaveLength(6);
      expect(tables.filter((id) => id.includes("data"))).toEqual([]);
    },
  );

  it.each(each)(
    "[NFR-7] lets only this account's flow logs in %s act as the flow-log role",
    (_, template) => {
      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: [
            Match.objectLike({
              Principal: { Service: "vpc-flow-logs.amazonaws.com" },
              Condition: {
                StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } },
                ArnLike: { "aws:SourceArn": Match.anyValue() },
              },
            }),
          ],
        },
      });
    },
  );

  it.each(each)("[NFR-7] keeps %s's flow logs and their key when the stack goes", (_, template) => {
    template.hasResource("AWS::KMS::Key", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
    template.hasResource("AWS::Logs::LogGroup", { DeletionPolicy: "Retain" });
  });

  it.each(each)("[NFR-7] strips %s's default security group of its rules", (_, template) => {
    template.hasResourceProperties("Custom::VpcRestrictDefaultSG", {
      DefaultSecurityGroupId: {
        "Fn::GetAtt": [Match.stringLikeRegexp("^Vpc"), "DefaultSecurityGroup"],
      },
    });
  });
});
