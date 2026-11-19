import { Stack, type StackProps } from "aws-cdk-lib";
import {
  FlowLogDestination,
  FlowLogTrafficType,
  GatewayVpcEndpointAwsService,
  IpAddresses,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { LogGroup } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./config.ts";
import { encryptedLogGroups } from "./logs.ts";

export interface NetworkStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

/** The VPC everything else runs in: three zones, with data stores in subnets with no route out. */
export class NetworkStack extends Stack {
  readonly vpc: Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const { config } = props;

    const [flowLogs] = encryptedLogGroups(this, "FlowLog", config.logRetentionDays) as [LogGroup];
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
