import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
  InstanceType,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  type IVpc,
} from "aws-cdk-lib/aws-ec2";
import { CfnReplicationGroup, CfnSubnetGroup } from "aws-cdk-lib/aws-elasticache";
import { Key } from "aws-cdk-lib/aws-kms";
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  ParameterGroup,
  PostgresEngineVersion,
  StorageType,
} from "aws-cdk-lib/aws-rds";
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./config.ts";
import { encryptedLogGroups } from "./logs.ts";

export interface DataStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly vpc: IVpc;
}

const POSTGRES_PORT = 5432;
// The logs RDS exports for Postgres, into groups it would otherwise create itself (A-25).
const DATABASE_LOGS = ["postgresql", "upgrade"] as const;
const CACHE_PORT = 6379;

const rotatingKey = (scope: Construct, id: string, description: string) =>
  new Key(scope, id, { description, enableKeyRotation: true, removalPolicy: RemovalPolicy.RETAIN });

/**
 * The stores: Postgres for workspaces, Valkey for the upstream cache and limits, and a bucket for
 * the router's fallback config. Each has its own key, sits in the data subnets, takes only TLS,
 * and admits only the `clients` security group, which services join in M7 (NFR-7).
 */
export class DataStack extends Stack {
  /** Join this to reach the database and the cache; nothing else can. */
  readonly clients: SecurityGroup;
  readonly database: DatabaseInstance;
  readonly cacheAuth: Secret;
  readonly routerConfig: Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config, vpc } = props;

    const databaseSecurity = new SecurityGroup(this, "DatabaseSecurity", {
      vpc,
      description: "Postgres: only from data clients",
      allowAllOutbound: false,
      // Rules as their own resources, since these groups refer to each other.
      disableInlineRules: true,
    });
    const cacheSecurity = new SecurityGroup(this, "CacheSecurity", {
      vpc,
      description: "Valkey: only from data clients",
      allowAllOutbound: false,
      // Rules as their own resources, since these groups refer to each other.
      disableInlineRules: true,
    });
    this.clients = new SecurityGroup(this, "Clients", {
      vpc,
      description: "Services that use the database or the cache",
      allowAllOutbound: false,
      // Rules as their own resources, since these groups refer to each other.
      disableInlineRules: true,
    });
    for (const [store, port] of [
      [databaseSecurity, POSTGRES_PORT],
      [cacheSecurity, CACHE_PORT],
    ] as const) {
      store.addIngressRule(Peer.securityGroupId(this.clients.securityGroupId), Port.tcp(port));
      this.clients.addEgressRule(Peer.securityGroupId(store.securityGroupId), Port.tcp(port));
    }

    this.database = this.createDatabase(config, vpc, databaseSecurity);
    this.cacheAuth = this.createCache(config, vpc, cacheSecurity);
    this.routerConfig = this.createRouterConfigBucket();
  }

  private createDatabase(config: EnvironmentConfig, vpc: IVpc, security: SecurityGroup) {
    const { database } = config;
    const engine = DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_17_9 });
    const credentialKey = rotatingKey(this, "DatabaseSecretKey", "Encrypts the database login");
    const instanceIdentifier = `traverse-${config.name}`;
    const logs = encryptedLogGroups(
      this,
      "DatabaseLog",
      config.logRetentionDays,
      DATABASE_LOGS.map((type) => `/aws/rds/instance/${instanceIdentifier}/${type}`),
    );
    const instance = new DatabaseInstance(this, "Database", {
      engine,
      instanceIdentifier,
      instanceType: new InstanceType(database.instanceType),
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [security],
      multiAz: database.multiAz,
      databaseName: "traverse",
      credentials: Credentials.fromGeneratedSecret("traverse", { encryptionKey: credentialKey }),
      storageType: StorageType.GP3,
      allocatedStorage: database.allocatedStorageGb,
      maxAllocatedStorage: database.maxAllocatedStorageGb,
      storageEncrypted: true,
      storageEncryptionKey: rotatingKey(this, "DatabaseKey", "Encrypts the database"),
      // Connections without TLS are refused by the server itself.
      parameterGroup: new ParameterGroup(this, "DatabaseParameters", {
        engine,
        parameters: {
          "rds.force_ssl": "1",
          // Errors are logged with their statement, which is parameterised SQL. These keep the
          // values out: no statements logged for their own sake, and no parameters with errors.
          log_statement: "none",
          log_parameter_max_length: "0",
          log_parameter_max_length_on_error: "0",
        },
      }),
      iamAuthentication: true,
      // Backups give point-in-time recovery, which meets the 5-minute RPO (SLOS).
      backupRetention: Duration.days(database.backupRetentionDays),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      autoMinorVersionUpgrade: true,
      cloudwatchLogsExports: [...DATABASE_LOGS],
      publiclyAccessible: false,
    });
    // RDS creates a missing group itself, without a key or a retention, so ours must come first.
    for (const group of logs) instance.node.addDependency(group);
    // Kept with the snapshot a removal leaves, so its login survives it.
    // `instance.secret` is its attachment to the instance; the login itself is this child.
    (instance.node.findChild("Secret") as Secret).applyRemovalPolicy(RemovalPolicy.RETAIN);
    return instance;
  }

  private createCache(config: EnvironmentConfig, vpc: IVpc, security: SecurityGroup) {
    const { cache } = config;
    const auth = new Secret(this, "CacheAuth", {
      description: "The AUTH token clients send to Valkey",
      encryptionKey: rotatingKey(this, "CacheSecretKey", "Encrypts the cache AUTH token"),
      // Letters and digits only: of the rest, an AUTH token allows just `!&#$^<>-` (A-24).
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const subnets = new CfnSubnetGroup(this, "CacheSubnets", {
      description: "The data subnets",
      subnetIds: vpc.selectSubnets({ subnetType: SubnetType.PRIVATE_ISOLATED }).subnetIds,
    });
    const replicated = cache.nodes > 1;
    new CfnReplicationGroup(this, "Cache", {
      replicationGroupDescription: "Upstream cache and rate limits",
      engine: "valkey",
      engineVersion: "8.2",
      cacheNodeType: cache.nodeType,
      numCacheClusters: cache.nodes,
      automaticFailoverEnabled: replicated,
      multiAzEnabled: replicated,
      cacheSubnetGroupName: subnets.ref,
      securityGroupIds: [security.securityGroupId],
      port: CACHE_PORT,
      atRestEncryptionEnabled: true,
      kmsKeyId: rotatingKey(this, "CacheKey", "Encrypts the cache").keyArn,
      transitEncryptionEnabled: true,
      transitEncryptionMode: "required",
      // A reference CloudFormation resolves at deploy time; the token never enters the template.
      authToken: auth.secretValue.unsafeUnwrap(),
      snapshotRetentionLimit: 1,
      autoMinorVersionUpgrade: true,
    });
    return auth;
  }

  private createRouterConfigBucket() {
    const logs = new Bucket(this, "RouterConfigAccessLogs", {
      // S3 delivers server access logs only to a bucket with S3-managed keys.
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(365) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    return new Bucket(this, "RouterConfig", {
      encryption: BucketEncryption.KMS,
      encryptionKey: rotatingKey(this, "RouterConfigKey", "Encrypts the router's fallback config"),
      bucketKeyEnabled: true,
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      serverAccessLogsBucket: logs,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
