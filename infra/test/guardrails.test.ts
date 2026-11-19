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
  ciCredentialProblems,
  everyStack,
  identifiersIn,
  longLivedKeys,
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
    expect(stacks.map(({ path }) => path).sort()).toEqual([
      "traverse-production-network",
      "traverse-staging-network",
    ]);
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

    acknowledgeReviewed(stack, "network", [{ ...entry, path: "/Logs" }]);
    expect(acknowledgementsIn(stack.node.root as Stage)).toEqual([
      { path: "/Logs", id: "AwsSolutions-S1", reason: "reviewed" },
    ]);
    expect(() => acknowledgeReviewed(stack, "network", [{ ...entry, path: "/Gone" }])).toThrow(
      "no construct at /Gone in network",
    );
  });

  it("[GR-5] refuse a namespaced rule ID, which would let warnings through", () => {
    const stack = new Stack(newApp(), "network");
    new Bucket(stack, "Logs");

    expect(() =>
      acknowledgeReviewed(stack, "network", [
        { stack: "network", path: "/Logs", id: "AwsSolutions::AwsSolutions-S1", reason: "x" },
      ]),
    ).toThrow("acknowledge AwsSolutions::AwsSolutions-S1 by its bare rule ID");
  });

  it("[GR-5] are applied by the app for each stack", () => {
    const applied = buildApp(newApp(), []);
    expect(acknowledgementsIn(applied)).toEqual([]);
    expect(read("infra/src/app.ts")).toMatch(/acknowledgeReviewed\(network, "network"\)/);
  });
});
