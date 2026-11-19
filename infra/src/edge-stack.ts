import {
  ArnFormat,
  CfnParameter,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager";
import {
  AccountRecovery,
  CfnManagedLoginBranding,
  CfnUserPoolClient,
  FeaturePlan,
  ManagedLoginVersion,
  Mfa,
  OAuthScope,
  ResourceServerScope,
  UserPool,
  UserPoolClientIdentityProvider,
  UserPoolResourceServer,
} from "aws-cdk-lib/aws-cognito";
import { SubnetType, type IVpc } from "aws-cdk-lib/aws-ec2";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  DesyncMitigationMode,
  ListenerAction,
  SslPolicy,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ARecord, HostedZone, RecordTarget, type IHostedZone } from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import { CfnLoggingConfiguration, CfnWebACL, CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./config.ts";
import { encryptedLogGroups } from "./logs.ts";
import { RetentionDays } from "aws-cdk-lib/aws-logs";

export interface EdgeStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly vpc: IVpc;
}

// The router's own limit is 60 seconds, so the balancer gives up first (C-38).
const IDLE_TIMEOUT = Duration.seconds(55);

const visibility = (metricName: string) => ({
  metricName,
  cloudWatchMetricsEnabled: true,
  // Sampled requests keep whole headers, unredacted, so tokens and cookies would show (GR-4).
  sampledRequestsEnabled: false,
});
const managed = (name: string, priority: number, overrides: string[] = []) => ({
  name,
  priority,
  overrideAction: { none: {} },
  statement: {
    managedRuleGroupStatement: {
      vendorName: "AWS",
      name,
      // A rule here counts instead of blocking; the reason is beside each list below.
      ruleActionOverrides: overrides.map((rule) => ({
        name: rule,
        actionToUse: { count: {} },
      })),
    },
  },
  visibilityConfig: visibility(name),
});

/** The rate limit first, then AWS's managed groups, each blocking unless noted (FR-GW-6). */
const firewallRules = (config: EnvironmentConfig) => [
  {
    name: "RateLimit",
    priority: 0,
    action: { block: {} },
    statement: {
      rateBasedStatement: {
        limit: config.edge.rateLimitPerFiveMinutes,
        evaluationWindowSec: 300,
        aggregateKeyType: "IP",
      },
    },
    visibilityConfig: visibility("RateLimit"),
  },
  managed("AWSManagedRulesAmazonIpReputationList", 1),
  // Drafts and suggestions are past this group's 8 KB body limit. Bodies are capped behind it
  // instead: the web server's API at 32 KB, 256 KB for suggestions and 1 MB for a saved
  // workspace, and the router at 1 MB (`max_request_body_size`). So the size only counts here.
  managed("AWSManagedRulesCommonRuleSet", 2, ["SizeRestrictions_BODY"]),
  managed("AWSManagedRulesKnownBadInputsRuleSet", 3),
];

/**
 * What faces the internet: the load balancer behind a WAF, its certificate and names, and the user
 * pool. Names and the hosted zone are parameters given at deploy time, so none of them is in this
 * public code.
 */
export class EdgeStack extends Stack {
  readonly loadBalancer: ApplicationLoadBalancer;
  readonly userPool: UserPool;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    const { config, vpc } = props;
    const parameter = (name: string, description: string) =>
      new CfnParameter(this, name, { type: "String", description, minLength: 1 }).valueAsString;
    const appDomain = parameter(
      "AppDomainName",
      "The web app's host name, such as app.example.com",
    );
    const routerDomain = parameter("RouterDomainName", "The public router's host name");
    const zone = HostedZone.fromHostedZoneId(
      this,
      "Zone",
      new CfnParameter(this, "HostedZoneId", {
        type: "AWS::Route53::HostedZone::Id",
        description: "The hosted zone the subdomain is delegated to",
      }).valueAsString,
    );

    this.loadBalancer = this.createLoadBalancer(vpc, zone, [appDomain, routerDomain]);
    this.userPool = this.createUserPool(
      config,
      appDomain,
      routerDomain,
      parameter("AuthDomainPrefix", "The prefix of the user pool's managed login domain"),
    );
    // Managed login is served from Cognito's domain, not the load balancer, so the firewall
    // guards the user pool too.
    this.createFirewall(config, [
      ["LoadBalancer", this.loadBalancer.loadBalancerArn],
      ["UserPool", this.userPool.userPoolArn],
    ]);
  }

  private createLoadBalancer(vpc: IVpc, zone: IHostedZone, names: string[]) {
    const [appDomain = "", routerDomain = ""] = names;
    const certificate = new Certificate(this, "Certificate", {
      domainName: appDomain,
      subjectAlternativeNames: [routerDomain],
      validation: CertificateValidation.fromDns(zone),
    });
    const loadBalancer = new ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      internetFacing: true,
      idleTimeout: IDLE_TIMEOUT,
      dropInvalidHeaderFields: true,
      desyncMitigationMode: DesyncMitigationMode.STRICTEST,
      deletionProtection: true,
    });
    loadBalancer.addListener("Https", {
      protocol: ApplicationProtocol.HTTPS,
      certificates: [certificate],
      sslPolicy: SslPolicy.TLS13_RES,
      // Nothing behind it until M7 adds the services.
      defaultAction: ListenerAction.fixedResponse(404, { contentType: "text/plain" }),
    });
    loadBalancer.addListener("Http", {
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.redirect({ protocol: "HTTPS", port: "443", permanent: true }),
    });
    // No access logs: they record every query string, so a GraphQL GET's variables and sign-in's
    // authorization codes, and can't redact any (GR-4). The firewall's log, redacted, is the
    // record of what reached the edge.
    for (const [index, name] of names.entries()) {
      new ARecord(this, `Alias${String(index)}`, {
        zone,
        // A trailing dot makes it the whole name; without one CDK appends the zone's name.
        recordName: `${name}.`,
        target: RecordTarget.fromAlias(new LoadBalancerTarget(loadBalancer)),
      });
    }
    return loadBalancer;
  }

  private createFirewall(config: EnvironmentConfig, guarded: [string, string][]) {
    const acl = new CfnWebACL(this, "Firewall", {
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: visibility("traverse-edge"),
      rules: firewallRules(config),
    });
    for (const [id, resourceArn] of guarded) {
      new CfnWebACLAssociation(this, `FirewallOn${id}`, { resourceArn, webAclArn: acl.attrArn });
    }
    // WAF delivers only to log groups whose names start `aws-waf-logs-`.
    const name = `aws-waf-logs-traverse-${config.name}`;
    // A month in every environment: it holds the addresses of what was blocked (GR-4).
    encryptedLogGroups(this, "FirewallLog", RetentionDays.ONE_MONTH, [name]);
    new CfnLoggingConfiguration(this, "FirewallLogging", {
      resourceArn: acl.attrArn,
      // WAF takes the group's ARN without the `:*` CloudWatch Logs adds.
      logDestinationConfigs: [
        this.formatArn({
          service: "logs",
          resource: "log-group",
          resourceName: name,
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        }),
      ],
      // Sessions and tokens travel in these headers, and a GraphQL GET's variables and sign-in's
      // authorization code in the query string: none of them reaches a log (GR-4).
      redactedFields: [
        { singleHeader: { Name: "authorization" } },
        { singleHeader: { Name: "cookie" } },
        // A page's address, query string included, comes back in the next request's Referer.
        { singleHeader: { Name: "referer" } },
        { queryString: {} },
      ],
      // Only what the firewall blocked or counted, so ordinary visitors leave no address behind.
      loggingFilter: {
        DefaultBehavior: "DROP",
        Filters: [
          {
            Behavior: "KEEP",
            Requirement: "MEETS_ANY",
            Conditions: [
              { ActionCondition: { Action: "BLOCK" } },
              { ActionCondition: { Action: "COUNT" } },
            ],
          },
        ],
      },
    }).node.addDependency(this.node.findChild("FirewallLog0"));
  }

  /** The web server's client: a confidential one, using authorization code and PKCE only. */
  private createClient(
    config: EnvironmentConfig,
    pool: UserPool,
    appDomain: string,
    scope: OAuthScope,
  ) {
    const client = pool.addClient("Web", {
      generateSecret: true,
      authFlows: {},
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [scope],
        callbackUrls: [`https://${appDomain}/auth/callback`],
        logoutUrls: [`https://${appDomain}/`],
      },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.minutes(config.auth.accessTokenMinutes),
      idTokenValidity: Duration.minutes(config.auth.accessTokenMinutes),
      refreshTokenValidity: Duration.days(config.auth.refreshTokenDays),
    });
    // Managed login only: no password, SRP or custom flows straight to the API. CDK leaves the
    // list out when every flow is off, and Cognito then turns SRP and custom auth on (A-31).
    (client.node.defaultChild as CfnUserPoolClient).addPropertyOverride("ExplicitAuthFlows", [
      "ALLOW_REFRESH_TOKEN_AUTH",
    ]);
    return client;
  }

  /**
   * The user pool the web server signs users in through (ADR 0020). Its access tokens are bound to
   * the router (A-12), which needs managed login. The app asks for no ID token, so no email
   * reaches Traverse.
   */
  private createUserPool(
    config: EnvironmentConfig,
    appDomain: string,
    routerDomain: string,
    domainPrefix: string,
  ) {
    const pool = new UserPool(this, "Users", {
      featurePlan: FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const graph = new ResourceServerScope({
      scopeName: "graph",
      scopeDescription: "Use the graph",
    });
    const router = new UserPoolResourceServer(this, "Router", {
      userPool: pool,
      // The access token's audience, which the router and subgraphs check (GR-3).
      identifier: `https://${routerDomain}`,
      scopes: [graph],
    });
    const client = this.createClient(
      config,
      pool,
      appDomain,
      OAuthScope.resourceServer(router, graph),
    );
    pool.addDomain("Login", {
      cognitoDomain: { domainPrefix },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    new CfnManagedLoginBranding(this, "LoginBranding", {
      userPoolId: pool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    return pool;
  }
}
