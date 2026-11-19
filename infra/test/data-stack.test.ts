import { Match, type Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { DataStack } from "../src/data-stack.ts";
import { onEachNetwork } from "./support/app.ts";

const templates = onEachNetwork((app, props) => new DataStack(app, "data", props));
const each = [...templates.entries()];
const staging = templates.get("staging") as Template;
const production = templates.get("production") as Template;

const isolatedSubnets = Match.arrayWith([
  Match.objectLike({ "Fn::GetStackOutput": Match.objectLike({}) }),
]);

describe("the data stack", () => {
  it.each(each)("[NFR-7] keeps %s's Postgres encrypted, private and on TLS only", (_, template) => {
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      Engine: "postgres",
      EngineVersion: "17.9",
      StorageEncrypted: true,
      KmsKeyId: { "Fn::GetAtt": [Match.stringLikeRegexp("^DatabaseKey"), "Arn"] },
      PubliclyAccessible: false,
      EnableIAMDatabaseAuthentication: true,
      DeletionProtection: true,
    });
    template.hasResourceProperties("AWS::RDS::DBParameterGroup", {
      Family: "postgres17",
      Parameters: { "rds.force_ssl": "1" },
    });
    template.hasResource("AWS::RDS::DBInstance", {
      DeletionPolicy: "Snapshot",
      UpdateReplacePolicy: "Snapshot",
    });
  });

  it("[NFR-7] runs Postgres in two zones in production and keeps two weeks of backups", () => {
    production.hasResourceProperties("AWS::RDS::DBInstance", {
      MultiAZ: true,
      BackupRetentionPeriod: 14,
    });
    staging.hasResourceProperties("AWS::RDS::DBInstance", {
      MultiAZ: false,
      BackupRetentionPeriod: 7,
    });
  });

  it.each(each)("[NFR-7] puts %s's stores in the data subnets", (_, template) => {
    template.hasResourceProperties("AWS::RDS::DBSubnetGroup", { SubnetIds: isolatedSubnets });
    template.hasResourceProperties("AWS::ElastiCache::SubnetGroup", { SubnetIds: isolatedSubnets });
    expect(JSON.stringify(template.findResources("AWS::RDS::DBSubnetGroup"))).toMatch(/dataSubnet/);
    expect(JSON.stringify(template.findResources("AWS::ElastiCache::SubnetGroup"))).toMatch(
      /dataSubnet/,
    );
  });

  it.each(each)("[NFR-7] encrypts %s's cache at rest and requires TLS and AUTH", (_, template) => {
    template.hasResourceProperties("AWS::ElastiCache::ReplicationGroup", {
      Engine: "valkey",
      EngineVersion: "8.2",
      AtRestEncryptionEnabled: true,
      KmsKeyId: { "Fn::GetAtt": [Match.stringLikeRegexp("^CacheKey"), "Arn"] },
      TransitEncryptionEnabled: true,
      TransitEncryptionMode: "required",
      // A dynamic reference, resolved by CloudFormation; the token itself is in no template.
      AuthToken: {
        "Fn::Join": [
          "",
          Match.arrayWith([Match.stringLikeRegexp("^\\{\\{resolve:secretsmanager:")]),
        ],
      },
    });
  });

  it("[NFR-7] runs a cache replica in another zone in production", () => {
    production.hasResourceProperties("AWS::ElastiCache::ReplicationGroup", {
      NumCacheClusters: 2,
      MultiAZEnabled: true,
      AutomaticFailoverEnabled: true,
    });
    staging.hasResourceProperties("AWS::ElastiCache::ReplicationGroup", {
      NumCacheClusters: 1,
      MultiAZEnabled: false,
    });
  });

  it.each(each)(
    "[NFR-7] admits only data clients to %s's stores, on their own ports",
    (_, template) => {
      // Two ways in, and no others: one rule for each store.
      template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 2);
      for (const port of [5432, 6379]) {
        template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
          FromPort: port,
          ToPort: port,
          SourceSecurityGroupId: { "Fn::GetAtt": [Match.stringLikeRegexp("^Clients"), "GroupId"] },
        });
        template.hasResourceProperties("AWS::EC2::SecurityGroupEgress", {
          FromPort: port,
          GroupId: { "Fn::GetAtt": [Match.stringLikeRegexp("^Clients"), "GroupId"] },
        });
      }
    },
  );

  it.each(each)(
    "[NFR-7] keeps %s's router config versioned, private and on TLS only",
    (_, template) => {
      template.hasResourceProperties("AWS::S3::Bucket", {
        VersioningConfiguration: { Status: "Enabled" },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            Match.objectLike({
              ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: "aws:kms" }),
            }),
          ],
        },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        LoggingConfiguration: Match.objectLike({ DestinationBucketName: Match.anyValue() }),
      });
    },
  );

  it.each(each)(
    "[NFR-7] gives each of %s's stores its own rotating key, kept on removal",
    (_, template) => {
      const keys = template.findResources("AWS::KMS::Key");

      expect(
        Object.keys(keys)
          .map((id) => id.replace(/[0-9A-F]{8}$/, ""))
          .sort(),
      ).toEqual([
        "CacheKey",
        "CacheSecretKey",
        "DatabaseKey",
        "DatabaseLogKey",
        "DatabaseSecretKey",
        "RouterConfigKey",
      ]);
      for (const key of Object.values(keys)) {
        expect(key).toMatchObject({
          Properties: { EnableKeyRotation: true },
          DeletionPolicy: "Retain",
        });
      }
    },
  );

  it.each(each)(
    "[NFR-7] owns %s's database log groups, under a key, for a set time",
    (name, template) => {
      for (const type of ["postgresql", "upgrade"]) {
        template.hasResource("AWS::Logs::LogGroup", {
          Properties: {
            LogGroupName: `/aws/rds/instance/traverse-${name}/${type}`,
            KmsKeyId: { "Fn::GetAtt": [Match.stringLikeRegexp("^DatabaseLogKey"), "Arn"] },
            RetentionInDays: name === "staging" ? 30 : 365,
          },
          DeletionPolicy: "Retain",
        });
      }
      // RDS would create them itself, unencrypted and kept forever, if it got there first.
      const [instance] = Object.values(template.findResources("AWS::RDS::DBInstance"));
      expect(instance?.DependsOn).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^DatabaseLog0/),
          expect.stringMatching(/^DatabaseLog1/),
        ]),
      );
      template.hasResourceProperties("AWS::RDS::DBInstance", {
        DBInstanceIdentifier: `traverse-${name}`,
        EnableCloudwatchLogsExports: ["postgresql", "upgrade"],
      });
    },
  );

  it.each(each)("[GR-4] keeps parameter values out of %s's database logs", (_, template) => {
    template.hasResourceProperties("AWS::RDS::DBParameterGroup", {
      Parameters: {
        log_statement: "none",
        log_parameter_max_length: "0",
        log_parameter_max_length_on_error: "0",
      },
    });
  });

  it.each(each)(
    "[NFR-7] keeps %s's secrets when the stack goes, as it keeps the snapshot",
    (_, template) => {
      const secrets = Object.values(template.findResources("AWS::SecretsManager::Secret"));

      expect(secrets).toHaveLength(2);
      for (const secret of secrets) expect(secret).toMatchObject({ DeletionPolicy: "Retain" });
    },
  );
});
