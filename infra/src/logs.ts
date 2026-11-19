import { ArnFormat, RemovalPolicy, type Stack } from "aws-cdk-lib";
import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { LogGroup, type RetentionDays } from "aws-cdk-lib/aws-logs";

/**
 * Log groups under one rotating key, which only this account's log groups may use. Given names,
 * it makes those groups, so a service that would otherwise create its own (RDS does) writes into
 * groups CDK owns, with a key and a retention. Without names, it makes one group.
 */
export const encryptedLogGroups = (
  stack: Stack,
  id: string,
  retention: RetentionDays,
  names: readonly string[] = [],
): LogGroup[] => {
  const key = new Key(stack, `${id}Key`, {
    description: `Encrypts the ${id} log groups`,
    enableKeyRotation: true,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  // CloudWatch Logs encrypts with the key only for this account's log groups in this Region.
  key.grantEncryptDecrypt(
    new ServicePrincipal(`logs.${stack.region}.amazonaws.com`).withConditions({
      ArnLike: {
        "kms:EncryptionContext:aws:logs:arn": stack.formatArn({
          service: "logs",
          resource: "log-group",
          resourceName: "*",
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        }),
      },
    }),
  );
  const groups = names.length === 0 ? [undefined] : names;
  return groups.map(
    (logGroupName, index) =>
      new LogGroup(stack, names.length === 0 ? `${id}s` : `${id}${String(index)}`, {
        logGroupName,
        encryptionKey: key,
        retention,
        removalPolicy: RemovalPolicy.RETAIN,
      }),
  );
};
