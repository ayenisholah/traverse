import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NestedStack, Stack, Stage, Validations } from "aws-cdk-lib";
import { CfnAccessKey, PolicyStatement, Role, ServicePrincipal, User } from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { AwsCustomResource, AwsCustomResourcePolicy } from "aws-cdk-lib/custom-resources";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import {
  acknowledgementsIn,
  bucketsTakingPlainText,
  ciCredentialProblems,
  everyStack,
  identifiersIn,
  longLivedKeys,
  openToTheInternet,
  unprotectedStores,
  type Template,
} from "../src/guardrails.ts";
import { main } from "../src/main.ts";
import { acknowledgeReviewed, REVIEWED_ACKNOWLEDGEMENTS } from "../src/nag-suppressions.ts";
import { newApp } from "./support/app.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");
const filesUnder = (path: string): string[] =>
  readdirSync(`${root}${path}`).flatMap((name) => {
    const child = `${path}/${name}`;
    if (["node_modules", "cdk.out"].includes(name)) return [];
    return statSync(`${root}${child}`).isDirectory() ? filesUnder(child) : [child];
  });

// The app exactly as `cdk synth` builds it: cdk-nag fails synthesis on any finding left.
const app = main(newApp());
app.synth();
const stacks = everyStack(app);

describe("the app's guardrails", () => {
  it("[GR-5] synthesizes every stack with cdk-nag's AWS Solutions checks passing", () => {
    expect(stacks.map(({ path }) => path).sort()).toEqual(
      [
        "traverse-budgets",
        ...["staging", "production"].flatMap((name) =>
          ["data", "edge", "network"].map((kind) => `traverse-${name}-${kind}`),
        ),
      ].sort(),
    );
  });

  it("[GR-5] runs only what the app module builds", () => {
    expect(read("infra/bin/traverse.ts")).toBe(
      'import { main } from "../src/main.ts";\n\nmain().synth();\n',
    );
  });

  it("[GR-5] creates no IAM user and no access key, and nothing that could", () => {
    for (const { template } of stacks) expect(longLivedKeys(template)).toEqual([]);
  });

  it("[GR-5] finds a user, a key and a login made directly, in nested stacks and in stages", () => {
    const planted = newApp();
    const stack = new Stack(planted, "planted");
    new User(new NestedStack(stack, "nested"), "Hidden");
    new CfnAccessKey(new Stack(new Stage(planted, "stage"), "inner"), "Key", { userName: "x" });

    expect(
      everyStack(planted).map(({ path, template }) => [path, longLivedKeys(template).length]),
    ).toEqual([
      ["planted", 0],
      ["planted/nested", 1],
      ["stage/inner", 1],
    ]);
  });

  it("[GR-5] finds a policy or custom resource that could create keys", () => {
    const planted = newApp();
    const stack = new Stack(planted, "planted");
    new Role(stack, "Maker", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    }).addToPolicy(new PolicyStatement({ actions: ["iam:CreateAccessKey"], resources: ["*"] }));
    new AwsCustomResource(stack, "Call", {
      onCreate: {
        service: "IAM",
        action: "createUser",
        parameters: { UserName: "x" },
        physicalResourceId: { id: "x" },
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: ["*"] }),
      installLatestAwsSdk: false,
    });
    const template: Template = everyStack(planted)[0]?.template ?? {};

    expect(longLivedKeys(template).length).toBeGreaterThanOrEqual(2);
    expect(longLivedKeys({})).toEqual([]);
  });

  it("[GR-5] names no account and no person in any template or infrastructure file", () => {
    for (const { template } of stacks) expect(identifiersIn(JSON.stringify(template))).toEqual([]);
    for (const file of filesUnder("infra").filter((path) => !path.endsWith(".test.ts"))) {
      expect(identifiersIn(read(file)), file).toEqual([]);
    }
  });

  it("[GR-5] finds an account ID, also in an image URI, and an email", () => {
    expect(identifiersIn("123456789012.dkr.ecr.eu-north-1.amazonaws.com/router")).toEqual([
      "123456789012",
    ]);
    expect(identifiersIn("arn:aws:iam::123456789012:role/x")).toHaveLength(1);
    expect(identifiersIn("alerts to test-person@example.com")).toEqual(["test-person@example.com"]);
    expect(identifiersIn("1234567890123 and 12345678901")).toEqual([]);
  });

  it("[GR-5] holds no stored secrets and no AWS credentials in CI", () => {
    const files = [...filesUnder(".github"), "action.yml"].filter((path) => /\.ya?ml$/.test(path));

    expect(files.length).toBeGreaterThan(3);
    for (const file of files) expect(ciCredentialProblems(read(file)), file).toEqual([]);
  });

  it.each([
    ["a secret by any name", 'run: echo "${{ secrets.DEPLOY_CREDS }}" | ./deploy'],
    ["a credentials file", "run: cp creds ~/.aws/credentials"],
    ["a session token", "env: { AWS_SESSION_TOKEN: x }"],
    ["a key input", "with: { aws-access-key-id: x }"],
  ])("[GR-5] refuses %s in CI", (_, text) => {
    expect(ciCredentialProblems(text)).not.toEqual([]);
  });

  it("[GR-5] fails synthesis on a finding cdk-nag isn't told to accept", () => {
    const planted = buildApp(newApp(), []);
    new Bucket(new Stack(planted, "planted"), "Unencrypted");

    expect(() => planted.synth()).toThrow(/server access logs disabled\. \(AwsSolutions\)/);
  });

  it("[GR-5] synthesizes offline and strictly, in check and in CI", () => {
    const scripts = (JSON.parse(read("infra/package.json")) as { scripts: Record<string, string> })
      .scripts;

    expect(scripts.synth).toBe("cdk synth --quiet --no-notices --lookups=false --strict");
    expect(read("package.json")).toMatch(/npm run test:coverage && npm run synth:infra &&/);
    expect(read(".github/workflows/ci.yml")).toMatch(/run: npm run synth:infra\n/);
  });
});

describe("the app's stores", () => {
  it("[NFR-7] are all encrypted, with their own keys, and take only TLS", () => {
    for (const { path, template } of stacks) {
      expect(unprotectedStores(template), path).toEqual([]);
      expect(bucketsTakingPlainText(template), path).toEqual([]);
    }
  });

  it("[NFR-7] are open to nothing on the internet", () => {
    for (const { path, template } of stacks) expect(openToTheInternet(template), path).toEqual([]);
  });

  it("[NFR-7] can't lose a stack that others read from, or that holds data", () => {
    for (const stack of app.node.findAll().filter((node): node is Stack => Stack.isStack(node))) {
      expect(stack.terminationProtection, stack.stackName).toBe(true);
    }
  });

  const key = { "Fn::GetAtt": ["Key", "Arn"] };
  const withKey = (resources: Record<string, object>) => ({
    Resources: { Key: { Type: "AWS::KMS::Key" }, ...resources },
  });
  const store = (Type: string, Properties?: object) => withKey({ Store: { Type, Properties } });
  const parameters = {
    Type: "AWS::RDS::DBParameterGroup",
    Properties: { Parameters: { "rds.force_ssl": "1" } },
  };
  const instance = {
    StorageEncrypted: true,
    KmsKeyId: key,
    DBParameterGroupName: { Ref: "Parameters" },
  };
  const cache = {
    AtRestEncryptionEnabled: true,
    KmsKeyId: key,
    TransitEncryptionEnabled: true,
    TransitEncryptionMode: "required",
    AuthToken: "{{resolve:secretsmanager:x}}",
  };
  const kms = (KMSMasterKeyID: unknown) => ({
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [
        { ServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms", KMSMasterKeyID } },
      ],
    },
  });
  const sseS3 = {
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [
        { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
      ],
    },
  };

  it("[NFR-7] pass each kind of store that has its own key and TLS", () => {
    for (const template of [
      withKey({
        Parameters: parameters,
        Store: { Type: "AWS::RDS::DBInstance", Properties: instance },
      }),
      store("AWS::ElastiCache::ReplicationGroup", cache),
      store("AWS::S3::Bucket", kms(key)),
      store("AWS::SecretsManager::Secret", { KmsKeyId: key }),
      store("AWS::Logs::LogGroup", { KmsKeyId: { "Fn::GetAtt": ["Key", "Arn"] } }),
      store("AWS::SQS::Queue", { KmsMasterKeyId: { Ref: "Key" } }),
      store("AWS::SNS::Topic", { KmsMasterKeyId: key }),
      store("AWS::RDS::DBClusterParameterGroup", { Parameters: { "rds.force_ssl": "1" } }),
      // A bucket other buckets or a load balancer deliver logs to may use S3-managed keys.
      withKey({
        Store: { Type: "AWS::S3::Bucket", Properties: sseS3 },
        Source: {
          Type: "AWS::S3::Bucket",
          Properties: {
            ...kms(key),
            LoggingConfiguration: { DestinationBucketName: { Ref: "Store" } },
          },
        },
      }),
      withKey({
        Store: { Type: "AWS::S3::Bucket", Properties: sseS3 },
        Balancer: {
          Type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
          Properties: {
            LoadBalancerAttributes: [{ Key: "access_logs.s3.bucket", Value: { Ref: "Store" } }],
          },
        },
      }),
    ]) {
      expect(unprotectedStores(template)).toEqual([]);
    }
  });

  it.each([
    [
      "a database without encryption",
      "AWS::RDS::DBInstance",
      { ...instance, StorageEncrypted: false },
    ],
    [
      "a database under an AWS-managed key",
      "AWS::RDS::DBInstance",
      { ...instance, KmsKeyId: "alias/aws/rds" },
    ],
    [
      "a database with the default parameters",
      "AWS::RDS::DBInstance",
      { ...instance, DBParameterGroupName: undefined },
    ],
    [
      "a database whose parameters aren't here",
      "AWS::RDS::DBInstance",
      { ...instance, DBParameterGroupName: { Ref: "Elsewhere" } },
    ],
    [
      "parameters that don't force TLS",
      "AWS::RDS::DBParameterGroup",
      { Parameters: { "rds.force_ssl": "0" } },
    ],
    [
      "cluster parameters that don't force TLS",
      "AWS::RDS::DBClusterParameterGroup",
      { Parameters: {} },
    ],
    ["an Aurora cluster, which has no rule yet", "AWS::RDS::DBCluster", {}],
    [
      "a cache not encrypted at rest",
      "AWS::ElastiCache::ReplicationGroup",
      { ...cache, AtRestEncryptionEnabled: false },
    ],
    [
      "a cache under no key of its own",
      "AWS::ElastiCache::ReplicationGroup",
      { ...cache, KmsKeyId: "alias/aws/elasticache" },
    ],
    [
      "a cache without TLS",
      "AWS::ElastiCache::ReplicationGroup",
      { ...cache, TransitEncryptionEnabled: false },
    ],
    [
      "a cache with TLS only preferred",
      "AWS::ElastiCache::ReplicationGroup",
      { ...cache, TransitEncryptionMode: "preferred" },
    ],
    [
      "a cache without AUTH",
      "AWS::ElastiCache::ReplicationGroup",
      { ...cache, AuthToken: undefined },
    ],
    ["a bucket with no encryption", "AWS::S3::Bucket", {}],
    ["a bucket under an AWS-managed key", "AWS::S3::Bucket", kms("alias/aws/s3")],
    ["a bucket with S3-managed keys that takes no logs", "AWS::S3::Bucket", sseS3],
    ["a secret under the default key", "AWS::SecretsManager::Secret", {}],
    ["a log group without a key", "AWS::Logs::LogGroup", {}],
    ["a queue with SQS-managed keys", "AWS::SQS::Queue", { SqsManagedSseEnabled: true }],
    ["a topic under the AWS-managed key", "AWS::SNS::Topic", { KmsMasterKeyId: "alias/aws/sns" }],
    ["a serverless cache, which has no rule yet", "AWS::ElastiCache::ServerlessCache", {}],
    ["a DynamoDB table, which has no rule yet", "AWS::DynamoDB::Table", {}],
  ])("[NFR-7] find %s", (_, Type, Properties) => {
    expect(unprotectedStores(store(Type, Properties))).toEqual(["Store"]);
    expect(unprotectedStores(store(Type))).toEqual(["Store"]);
  });

  it("[NFR-7] find nothing in a template with no resources", () => {
    expect(unprotectedStores({})).toEqual([]);
    expect(bucketsTakingPlainText({})).toEqual([]);
    expect(openToTheInternet({})).toEqual([]);
  });

  const bucketArn = { "Fn::GetAtt": ["Bucket", "Arn"] };
  const enforced = {
    Effect: "Deny",
    Principal: { AWS: "*" },
    Action: "s3:*",
    Resource: [bucketArn, { "Fn::Join": ["", [bucketArn, "/*"]] }],
    Condition: { Bool: { "aws:SecureTransport": "false" } },
  };
  const bucketWith = (PolicyDocument?: object) => ({
    Resources: {
      Bucket: { Type: "AWS::S3::Bucket" },
      Policy: {
        Type: "AWS::S3::BucketPolicy",
        Properties: { Bucket: { Ref: "Bucket" }, PolicyDocument },
      },
    },
  });

  it("[NFR-7] accept a bucket whose policy refuses everyone everything without TLS", () => {
    expect(bucketsTakingPlainText(bucketWith({ Statement: [enforced] }))).toEqual([]);
    expect(
      bucketsTakingPlainText(bucketWith({ Statement: { ...enforced, Principal: "*" } })),
    ).toEqual([]);
  });

  it.each([
    ["no policy", undefined],
    ["a policy with no statements", {}],
    ["an allow", { Statement: [{ ...enforced, Effect: "Allow" }] }],
    [
      "a deny for one account",
      { Statement: [{ ...enforced, Principal: { AWS: "arn:aws:iam::111111111111:root" } }] },
    ],
    ["a deny of one action", { Statement: [{ ...enforced, Action: "s3:DeleteBucket" }] }],
    [
      "a deny of the bucket but not its objects",
      { Statement: [{ ...enforced, Resource: bucketArn }] },
    ],
    [
      "a deny on another condition",
      { Statement: [{ ...enforced, Condition: { Bool: { "aws:SecureTransport": "true" } } }] },
    ],
  ])("[NFR-7] find a bucket with %s", (_, document) => {
    expect(bucketsTakingPlainText(bucketWith(document))).toEqual(["Bucket"]);
  });

  const ingress = (rule: object) => ({
    Resources: { Rule: { Type: "AWS::EC2::SecurityGroupIngress", Properties: rule } },
  });
  const web = { IpProtocol: "tcp", FromPort: 443, ToPort: 443, CidrIp: "0.0.0.0/0" };

  it("[NFR-7] allow HTTPS and HTTP from anywhere, and anything from inside the VPC", () => {
    expect(openToTheInternet(ingress(web))).toEqual([]);
    expect(
      openToTheInternet(
        ingress({ ...web, FromPort: 80, ToPort: 80, CidrIp: undefined, CidrIpv6: "::/0" }),
      ),
    ).toEqual([]);
    expect(
      openToTheInternet(ingress({ ...web, FromPort: 5432, ToPort: 5432, CidrIp: "10.20.0.0/16" })),
    ).toEqual([]);
    expect(
      openToTheInternet(
        ingress({ IpProtocol: "tcp", FromPort: 5432, ToPort: 5432, SourceSecurityGroupId: "sg" }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["a data port from anywhere", { ...web, FromPort: 5432, ToPort: 5432 }],
    ["every protocol, whatever the ports say", { ...web, IpProtocol: "-1" }],
    ["UDP on 443", { ...web, IpProtocol: "udp" }],
    ["a range starting at 80", { ...web, FromPort: 80, ToPort: 65535 }],
    ["half the internet", { ...web, FromPort: 6379, ToPort: 6379, CidrIp: "0.0.0.0/1" }],
    ["one public address", { ...web, FromPort: 5432, ToPort: 5432, CidrIp: "203.0.113.7/32" }],
    [
      "a prefix list",
      { IpProtocol: "tcp", FromPort: 5432, ToPort: 5432, SourcePrefixListId: "pl-1" },
    ],
    ["a range known only at deploy time", { ...web, CidrIp: { Ref: "Range" } }],
  ])("[NFR-7] find a rule letting in %s", (_, rule) => {
    expect(openToTheInternet(ingress(rule))).toEqual(["Rule"]);
    expect(
      openToTheInternet({
        Resources: {
          Group: {
            Type: "AWS::EC2::SecurityGroup",
            Properties: { SecurityGroupIngress: [web, rule] },
          },
        },
      }),
    ).toEqual(["Group"]);
  });
});

describe("acknowledged findings", () => {
  it("[GR-5] are only ever the reviewed ones", () => {
    const reviewed = REVIEWED_ACKNOWLEDGEMENTS.map(({ path, id, reason }) => ({
      path,
      id,
      reason,
    }));

    for (const found of acknowledgementsIn(app)) expect(reviewed).toContainEqual(found);
  });

  it("[GR-5] are found when acknowledged anywhere else, even under the library's rule IDs", () => {
    const planted = newApp();
    const bucket = new Bucket(new Stack(planted, "planted"), "Quiet");
    Validations.of(bucket).acknowledge({ id: "AwsSolutions-S1", reason: "unreviewed" });
    Validations.of(bucket).acknowledge({ id: "CloudFormation-Validate::W3010", reason: "mine" });
    // Acknowledging on the app would cover every stack at once.
    Validations.of(planted).acknowledge({ id: "AwsSolutions-S2", reason: "everywhere" });

    expect(acknowledgementsIn(planted)).toEqual([
      { path: "", id: "AwsSolutions-S2", reason: "everywhere" },
      { path: "/Quiet", id: "AwsSolutions-S1", reason: "unreviewed" },
      { path: "/Quiet", id: "CloudFormation-Validate::W3010", reason: "mine" },
    ]);
  });

  it("[GR-5] apply to the construct a reviewed entry names, and fail when it's gone", () => {
    const stack = new Stack(newApp(), "network");
    new Bucket(stack, "Logs");
    const entry = { stack: "network" as const, id: "AwsSolutions-S1", reason: "reviewed" };

    acknowledgeReviewed(stack, "network", "staging", [{ ...entry, path: "/Logs" }]);
    expect(acknowledgementsIn(stack.node.root as Stage)).toEqual([
      { path: "/Logs", id: "AwsSolutions-S1", reason: "reviewed" },
    ]);
    expect(() =>
      acknowledgeReviewed(stack, "network", "staging", [{ ...entry, path: "/Gone" }]),
    ).toThrow("no construct at /Gone in network");
  });

  it("[GR-5] refuse a namespaced rule ID, which would let warnings through", () => {
    const stack = new Stack(newApp(), "network");
    new Bucket(stack, "Logs");

    expect(() =>
      acknowledgeReviewed(stack, "network", "staging", [
        { stack: "network", path: "/Logs", id: "AwsSolutions::AwsSolutions-S1", reason: "x" },
      ]),
    ).toThrow("acknowledge AwsSolutions::AwsSolutions-S1 by its bare rule ID");
  });

  it("[GR-5] are applied by the app, each only where its environment says", () => {
    const applied = acknowledgementsIn(app).map(({ path, id }) => `${path} ${id}`);

    // Staging's and production's data stacks, and the two accepted only on staging.
    expect(applied.filter((entry) => entry.includes("RDS11"))).toHaveLength(2);
    expect(applied.filter((entry) => entry.includes("RDS3"))).toHaveLength(1);
    expect(applied.filter((entry) => entry.includes("AEC4"))).toHaveLength(1);
    expect(REVIEWED_ACKNOWLEDGEMENTS.every(({ reason }) => reason.length > 40)).toBe(true);
  });
});
