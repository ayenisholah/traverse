import { Stack, Validations, type Stage } from "aws-cdk-lib";
import { Template as Assertions } from "aws-cdk-lib/assertions";
import type { IConstruct } from "constructs";

export interface Template {
  readonly Resources?: Readonly<
    Record<string, { readonly Type: string; readonly Properties?: unknown }>
  >;
}

const LONG_LIVED = new Set(["AWS::IAM::User", "AWS::IAM::AccessKey", "AWS::IAM::LoginProfile"]);
// The same, made another way: by a policy that may create them, or a custom resource that calls IAM.
const CREATES_KEYS =
  /iam:(?:CreateUser|CreateAccessKey|CreateLoginProfile|\*)|"action\\?":\\?"create(?:User|AccessKey|LoginProfile)/i;

/** Resources that hand out long-lived AWS keys, or could create them, which nothing may (GR-5). */
export const longLivedKeys = (template: Template): string[] =>
  Object.entries(template.Resources ?? {})
    .filter(
      ([, resource]) =>
        LONG_LIVED.has(resource.Type) || CREATES_KEYS.test(JSON.stringify(resource)),
    )
    .map(([logicalId]) => logicalId);

/** Every stack under a root, nested stacks and stacks in stages included, with its template. */
export const everyStack = (root: Stage): { path: string; template: Template }[] =>
  root.node
    .findAll()
    .filter((construct): construct is Stack => Stack.isStack(construct))
    .map((stack) => ({
      path: stack.node.path,
      template: Assertions.fromStack(stack).toJSON(),
    }));

const ACCOUNT_ID = /(?<!\d)\d{12}(?!\d)/;
const EMAIL = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/i;

/** What in a text names an account or a person, which the public repository may not (GR-5). */
export const identifiersIn = (text: string): string[] =>
  [ACCOUNT_ID, EMAIL].flatMap((pattern) => text.match(pattern) ?? []);

const AWS_CREDENTIALS =
  /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|AWS_SHARED_CREDENTIALS_FILE|aws-access-key-id|aws-secret-access-key|\.aws\/credentials/i;

/**
 * Why a workflow or action could hand CI AWS credentials. CI uses no stored secrets at all, so any
 * reference to one is refused, whatever it's named; deployments will use OIDC (GR-5, ADR 0004).
 */
export const ciCredentialProblems = (text: string): string[] => [
  ...(text.match(/secrets\.\w+/g) ?? []),
  ...(text.match(AWS_CREDENTIALS) ?? []),
];

export interface Acknowledgement {
  readonly path: string;
  readonly id: string;
  readonly reason: string;
}

/**
 * Acknowledgements aws-cdk-lib makes of its own template linter's rules, for what its constructs
 * emit. Only these exact ones are left out of the audit.
 */
const LIBRARY_OWN: readonly (readonly [string, string])[] = [
  [
    "CloudFormation-Validate::W3010",
    "Literal AZs in template are the result of accessing stack.availabilityZones, this is expected and safe",
  ],
  ...["F3002", "F3003"].map(
    (rule) =>
      [
        `CloudFormation-Validate::${rule}`,
        "AWS::EC2::FlowLog DestinationOptions accepts properties in camelCase, even they are listed as PascalCase in the spec",
      ] as const,
  ),
];

const isLibraryOwn = (id: string, reason: string) =>
  LIBRARY_OWN.some(([ownId, ownReason]) => ownId === id && ownReason === reason);

/**
 * Every rule acknowledged anywhere under the root, with the construct's path inside its stack,
 * except aws-cdk-lib's own.
 */
export const acknowledgementsIn = (root: Stage): Acknowledgement[] =>
  root.node.findAll().flatMap((construct: IConstruct) => {
    const stack = construct.node.scopes.findLast((scope): scope is Stack => Stack.isStack(scope));
    const prefix = stack?.node.path ?? "";
    return construct.node.metadata
      .filter(({ type }) => type === Validations.ACKNOWLEDGED_RULES_METADATA_KEY)
      .flatMap(({ data }) =>
        Object.entries(data as Record<string, string>)
          .filter(([id, reason]) => !isLibraryOwn(id, reason))
          .map(([id, reason]) => ({
            path: construct.node.path.slice(prefix.length),
            // CDK records a bare rule as `Annotation::<id>`.
            id: id.replace(/^Annotation::/, ""),
            reason,
          })),
      );
  });

type Properties = Readonly<Record<string, unknown>>;
type Resources = Readonly<
  Record<string, { readonly Type: string; readonly Properties?: Properties }>
>;

const resourcesOf = (template: Template) => (template.Resources ?? {}) as Resources;

/** Whether a value refers to a KMS key this template creates, not an AWS-managed alias or key. */
const isOwnKey = (resources: Resources, value: unknown): boolean => {
  const target = (value as { "Fn::GetAtt"?: [string, string]; Ref?: string } | undefined) ?? {};
  const id = target["Fn::GetAtt"]?.[0] ?? target.Ref;
  return id !== undefined && resources[id]?.Type === "AWS::KMS::Key";
};

const forcesTls = (p: Properties) =>
  (p.Parameters as Properties | undefined)?.["rds.force_ssl"] === "1";

/** Buckets other resources deliver logs to, which S3 and load balancers need SSE-S3 for (A-26). */
const logDestinations = (resources: Resources): Set<string> =>
  new Set(
    Object.values(resources).flatMap(({ Properties = {} }) => {
      const logging = Properties.LoggingConfiguration as Properties | undefined;
      const attributes = (Properties.LoadBalancerAttributes ?? []) as Properties[];
      return [
        logging?.DestinationBucketName,
        ...attributes
          .filter(({ Key }) => Key === "access_logs.s3.bucket")
          .map(({ Value }) => Value),
      ].flatMap((reference) => {
        const id = (reference as { Ref?: string } | undefined)?.Ref;
        return id === undefined ? [] : [id];
      });
    }),
  );

const bucketAlgorithm = (p: Properties) =>
  (
    (p.BucketEncryption as Properties | undefined)?.ServerSideEncryptionConfiguration as
      Properties[] | undefined
  )?.[0]?.ServerSideEncryptionByDefault as Properties | undefined;

type Rule = (properties: Properties, resources: Resources, id: string) => boolean;

// Each kind of store, and what it must say to be encrypted with its own key and take only TLS
// (NFR-7). A kind listed with no rule can't pass: give it one before using it.
const STORE_RULES: Readonly<Record<string, Rule>> = {
  "AWS::RDS::DBInstance": (p, r) =>
    p.StorageEncrypted === true &&
    isOwnKey(r, p.KmsKeyId) &&
    // Its parameters must be a group in this template, which the rule below holds to TLS.
    r[(p.DBParameterGroupName as { Ref?: string } | undefined)?.Ref ?? ""]?.Type ===
      "AWS::RDS::DBParameterGroup",
  "AWS::RDS::DBParameterGroup": forcesTls,
  "AWS::RDS::DBClusterParameterGroup": forcesTls,
  "AWS::RDS::DBCluster": () => false,
  "AWS::ElastiCache::ReplicationGroup": (p, r) =>
    p.AtRestEncryptionEnabled === true &&
    isOwnKey(r, p.KmsKeyId) &&
    p.TransitEncryptionEnabled === true &&
    p.TransitEncryptionMode === "required" &&
    p.AuthToken !== undefined,
  "AWS::S3::Bucket": (p, r, id) => {
    const algorithm = bucketAlgorithm(p);
    if (algorithm?.SSEAlgorithm === "aws:kms") return isOwnKey(r, algorithm.KMSMasterKeyID);
    return algorithm?.SSEAlgorithm === "AES256" && logDestinations(r).has(id);
  },
  "AWS::SecretsManager::Secret": (p, r) => isOwnKey(r, p.KmsKeyId),
  "AWS::Logs::LogGroup": (p, r) => isOwnKey(r, p.KmsKeyId),
  "AWS::SQS::Queue": (p, r) => isOwnKey(r, p.KmsMasterKeyId),
  "AWS::SNS::Topic": (p, r) => isOwnKey(r, p.KmsMasterKeyId),
  ...Object.fromEntries(
    [
      "AWS::ElastiCache::CacheCluster",
      "AWS::ElastiCache::ServerlessCache",
      "AWS::MemoryDB::Cluster",
      "AWS::DynamoDB::Table",
      "AWS::EFS::FileSystem",
      "AWS::EC2::Volume",
      "AWS::OpenSearchService::Domain",
      "AWS::DocDB::DBCluster",
      "AWS::Neptune::DBCluster",
      "AWS::Kinesis::Stream",
    ].map((type) => [type, () => false]),
  ),
};

/**
 * Stores that would hold data without their own key, or take connections without TLS: any listed
 * kind that fails its rule (NFR-7). Only buckets that receive logs may use S3-managed keys.
 */
export const unprotectedStores = (template: Template): string[] => {
  const resources = resourcesOf(template);
  return Object.entries(resources)
    .filter(([id, { Type, Properties = {} }]) => {
      const rule = STORE_RULES[Type];
      return rule !== undefined && !rule(Properties, resources, id);
    })
    .map(([id]) => id);
};

const coversBucket = (resource: unknown, id: string) => {
  const text = JSON.stringify(resource);
  return text.includes(`"${id}","Arn"`) && text.includes("/*");
};

// A statement that refuses everyone everything on the bucket and its objects without TLS, as
// `enforceSSL` writes it.
const refusesPlainText = (statement: Properties, id: string) =>
  statement.Effect === "Deny" &&
  ["*", JSON.stringify({ AWS: "*" })].includes(
    typeof statement.Principal === "string"
      ? statement.Principal
      : JSON.stringify(statement.Principal),
  ) &&
  [statement.Action].flat().includes("s3:*") &&
  coversBucket(statement.Resource, id) &&
  JSON.stringify(statement.Condition) ===
    JSON.stringify({ Bool: { "aws:SecureTransport": "false" } });

/** Buckets whose policy doesn't refuse every request made without TLS (NFR-7). */
export const bucketsTakingPlainText = (template: Template): string[] => {
  const resources = resourcesOf(template);
  const policies = Object.values(resources).filter(({ Type }) => Type === "AWS::S3::BucketPolicy");
  return Object.entries(resources)
    .filter(([, { Type }]) => Type === "AWS::S3::Bucket")
    .filter(
      ([id]) =>
        !policies.some(({ Properties = {} }) => {
          if (JSON.stringify(Properties.Bucket) !== JSON.stringify({ Ref: id })) return false;
          const document = (Properties.PolicyDocument ?? {}) as Properties;
          const statements = [document.Statement ?? []].flat() as Properties[];
          return statements.some((statement) => refusesPlainText(statement, id));
        }),
    )
    .map(([id]) => id);
};

const PRIVATE = /^10\./;
const WEB_PORTS = new Set([80, 443]);

/**
 * Security group rules that let anything outside the VPC in, other than TCP on 80 or 443 from
 * anywhere, inline or as their own resources. Only the load balancer may face the internet, and
 * only on those ports. A prefix list or a public range counts as outside.
 */
export const openToTheInternet = (template: Template): string[] => {
  const outside = (rule: Properties) => {
    if (rule.SourcePrefixListId !== undefined) return true;
    const range = rule.CidrIp ?? rule.CidrIpv6;
    if (range === undefined) return false;
    // A range CloudFormation works out at deploy time can't be judged here, so it counts as outside.
    if (typeof range !== "string") return true;
    if (PRIVATE.test(range)) return false;
    const web =
      ["0.0.0.0/0", "::/0"].includes(range) &&
      String(rule.IpProtocol) === "tcp" &&
      rule.FromPort === rule.ToPort &&
      WEB_PORTS.has(Number(rule.FromPort));
    return !web;
  };
  return Object.entries(resourcesOf(template)).flatMap(([id, { Type, Properties = {} }]) => {
    if (Type === "AWS::EC2::SecurityGroupIngress") return outside(Properties) ? [id] : [];
    if (Type !== "AWS::EC2::SecurityGroup") return [];
    const inline = (Properties.SecurityGroupIngress ?? []) as Properties[];
    return inline.some(outside) ? [id] : [];
  });
};
