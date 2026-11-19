import { Stack, Validations, type Stage } from "aws-cdk-lib";
import { Template as Assertions } from "aws-cdk-lib/assertions";
import type { IConstruct } from "constructs";

export interface Template {
  readonly Resources?: Readonly<Record<string, { readonly Type: string }>>;
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
