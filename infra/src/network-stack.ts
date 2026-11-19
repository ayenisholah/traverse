import { ArnFormat, Stack, type StackProps, RemovalPolicy } from "aws-cdk-lib";
import {
  FlowLogDestination,
  FlowLogTrafficType,
  GatewayVpcEndpointAwsService,
  IpAddresses,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { LogGroup, type RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./config.ts";

export interface NetworkStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

/** A log group under its own rotating key, which only this account's log groups may use. */
const encryptedLogGroup = (stack: Stack, id: string, retention: RetentionDays) => {
  const logKey = new Key(stack, `${id}Key`, {
    description: `Encrypts the ${id} log group`,
    enableKeyRotation: true,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  // CloudWatch Logs encrypts with the key only for this account's log groups in this Region.
  logKey.grantEncryptDecrypt(
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
  return new LogGroup(stack, `${id}s`, {
    encryptionKey: logKey,
    retention,
    removalPolicy: RemovalPolicy.RETAIN,
  });
};

/** The VPC everything else runs in: three zones, with data stores in subnets with no route out. */
export class NetworkStack extends Stack {
  readonly vpc: Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const { config } = props;

    const flowLogs = encryptedLogGroup(this, "FlowLog", config.logRetentionDays);
    // Only this account's flow logs may act as the role, so another account can't use it (confused
    // deputy).
    const flowLogRole = new Role(this, "FlowLogRole", {
      assumedBy: new ServicePrincipal("vpc-flow-logs.amazonaws.com").withConditions({
        StringEquals: { "aws:SourceAccount": this.account },
        ArnLike: {
          "aws:SourceArn": this.formatArn({
            service: "ec2",
            resource: "vpc-flow-log",
            resourceName: "*",
          }),
        },
      }),
    });

    this.vpc = new Vpc(this, "Vpc", {
      ipAddresses: IpAddresses.cidr(config.cidr),
      availabilityZones: config.availabilityZones,
      natGateways: config.natGateways,
      subnetConfiguration: [
        { name: "public", subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        { name: "services", subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 20 },
        { name: "data", subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      // The default security group admits nothing, so a resource left in it is cut off.
      restrictDefaultSecurityGroup: true,
      // Not the data subnets: with the endpoint they could reach any bucket in the Region.
      gatewayEndpoints: {
        S3: {
          service: GatewayVpcEndpointAwsService.S3,
          subnets: [
            { subnetType: SubnetType.PUBLIC },
            { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
          ],
        },
      },
      flowLogs: {
        all: {
          destination: FlowLogDestination.toCloudWatchLogs(flowLogs, flowLogRole),
          trafficType: FlowLogTrafficType.ALL,
        },
      },
    });
  }
}
