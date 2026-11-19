import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { EdgeStack } from "../src/edge-stack.ts";
import { onEachNetwork } from "./support/app.ts";

const templates = onEachNetwork((app, props) => new EdgeStack(app, "edge", props));
const each = [...templates.entries()];
const parameter = (name: string) => ({ Ref: name });

describe("the edge stack", () => {
  it.each(each)("[NFR-6] takes %s's names, zone and login domain at deploy time", (_, template) => {
    expect(Object.keys(template.toJSON().Parameters as object)).toEqual(
      expect.arrayContaining([
        "AppDomainName",
        "RouterDomainName",
        "HostedZoneId",
        "AuthDomainPrefix",
      ]),
    );
    template.hasParameter("HostedZoneId", { Type: "AWS::Route53::HostedZone::Id" });
  });

  it.each(each)("[FR-GW-6] serves %s over TLS only, with HTTP sent to HTTPS", (_, template) => {
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Protocol: "HTTPS",
      Port: 443,
      SslPolicy: "ELBSecurityPolicy-TLS13-1-2-Res-2021-06",
      DefaultActions: [
        Match.objectLike({
          Type: "fixed-response",
          FixedResponseConfig: Match.objectLike({ StatusCode: "404" }),
        }),
      ],
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Protocol: "HTTP",
      DefaultActions: [
        Match.objectLike({
          Type: "redirect",
          RedirectConfig: Match.objectLike({
            Protocol: "HTTPS",
            Port: "443",
            StatusCode: "HTTP_301",
          }),
        }),
      ],
    });
    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: parameter("AppDomainName"),
      SubjectAlternativeNames: [parameter("RouterDomainName")],
      ValidationMethod: "DNS",
    });
  });

  it.each(each)("[FR-GW-6] hardens %s's load balancer", (_, template) => {
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      Scheme: "internet-facing",
      LoadBalancerAttributes: Match.arrayWith([
        { Key: "deletion_protection.enabled", Value: "true" },
        // Below the router's 60 seconds, so the balancer gives up first (C-38).
        { Key: "idle_timeout.timeout_seconds", Value: "55" },
        { Key: "routing.http.drop_invalid_header_fields.enabled", Value: "true" },
        { Key: "routing.http.desync_mitigation_mode", Value: "strictest" },
      ]),
    });
  });

  it.each(each)(
    "[GR-4] keeps no load balancer access logs in %s, which can't redact query strings",
    (_, template) => {
      expect(
        JSON.stringify(template.findResources("AWS::ElasticLoadBalancingV2::LoadBalancer")),
      ).not.toMatch(/access_logs/);
      template.resourceCountIs("AWS::S3::Bucket", 0);
    },
  );

  it.each(each)("[FR-GW-6] points both of %s's names at the load balancer", (_, template) => {
    for (const name of ["AppDomainName", "RouterDomainName"]) {
      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Type: "A",
        HostedZoneId: parameter("HostedZoneId"),
        AliasTarget: Match.objectLike({ DNSName: Match.anyValue() }),
        // The name as given, never with the zone appended to it again.
        Name: { "Fn::Join": ["", [parameter(name), "."]] },
      });
    }
  });

  it.each(each)(
    "[FR-GW-6] blocks %s's floods and known bad traffic before the router",
    (name, template) => {
      const rules = template.findResources("AWS::WAFv2::WebACL") as Record<
        string,
        {
          Properties: {
            Rules: {
              Name: string;
              Priority: number;
              Action?: object;
              OverrideAction?: object;
              Statement: {
                RateBasedStatement?: { Limit: number };
                ManagedRuleGroupStatement?: { RuleActionOverrides?: { Name: string }[] };
              };
            }[];
          };
        }
      >;
      const [acl] = Object.values(rules);

      expect(acl?.Properties.Rules.map(({ Name, Priority }) => [Priority, Name])).toEqual([
        [0, "RateLimit"],
        [1, "AWSManagedRulesAmazonIpReputationList"],
        [2, "AWSManagedRulesCommonRuleSet"],
        [3, "AWSManagedRulesKnownBadInputsRuleSet"],
      ]);
      const [rate, ...groups] = acl?.Properties.Rules ?? [];
      const common = groups[1];
      expect(rate?.Action).toEqual({ Block: {} });
      // Each managed group acts as AWS wrote it, so its rules block; `count` would only watch.
      expect(groups.map(({ OverrideAction }) => OverrideAction)).toEqual([
        { None: {} },
        { None: {} },
        { None: {} },
      ]);
      expect(rate?.Statement.RateBasedStatement?.Limit).toBe(name === "staging" ? 1_000 : 2_000);
      // Only the body size counts rather than blocks; the web server caps bodies itself.
      expect(
        common?.Statement.ManagedRuleGroupStatement?.RuleActionOverrides?.map((rule) => rule.Name),
      ).toEqual(["SizeRestrictions_BODY"]);
      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Scope: "REGIONAL",
        DefaultAction: { Allow: {} },
      });
      // Managed login is on Cognito's domain, so the user pool needs the firewall as well.
      for (const resourceArn of [
        { Ref: Match.stringLikeRegexp("^LoadBalancer") },
        { "Fn::GetAtt": [Match.stringLikeRegexp("^Users"), "Arn"] },
      ]) {
        template.hasResourceProperties("AWS::WAFv2::WebACLAssociation", {
          ResourceArn: resourceArn,
          WebACLArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^Firewall"), "Arn"] },
        });
      }
    },
  );

  it.each(each)(
    "[GR-4] logs only what %s's firewall stopped, without tokens, cookies, referrers or query strings",
    (name, template) => {
      template.hasResourceProperties("AWS::WAFv2::LoggingConfiguration", {
        RedactedFields: [
          { SingleHeader: { Name: "authorization" } },
          { SingleHeader: { Name: "cookie" } },
          { SingleHeader: { Name: "referer" } },
          { QueryString: {} },
        ],
        // Blocked and counted requests only: an ordinary visitor's address isn't kept.
        LoggingFilter: {
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
        LogDestinationConfigs: [
          { "Fn::Join": ["", Match.arrayWith([`:log-group:aws-waf-logs-traverse-${name}`])] },
        ],
      });
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: `aws-waf-logs-traverse-${name}`,
        KmsKeyId: Match.anyValue(),
        RetentionInDays: 30,
      });
      // Sampled requests keep whole headers unredacted, so none are kept anywhere.
      expect(JSON.stringify(template.findResources("AWS::WAFv2::WebACL"))).not.toMatch(
        /"SampledRequestsEnabled":true/,
      );
    },
  );

  it.each(each)(
    "[FR-WB-10] binds %s's access tokens to the router, through managed login",
    (name, template) => {
      template.hasResourceProperties("AWS::Cognito::UserPool", {
        UserPoolTier: "ESSENTIALS",
        DeletionProtection: "ACTIVE",
        MfaConfiguration: "OPTIONAL",
        Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: 12 }) },
      });
      template.hasResource("AWS::Cognito::UserPool", { DeletionPolicy: "Retain" });
      template.hasResourceProperties("AWS::Cognito::UserPoolResourceServer", {
        Identifier: { "Fn::Join": ["", ["https://", parameter("RouterDomainName")]] },
        Scopes: [{ ScopeName: "graph", ScopeDescription: "Use the graph" }],
      });
      template.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
        Domain: parameter("AuthDomainPrefix"),
        ManagedLoginVersion: 2,
      });
      template.resourceCountIs("AWS::Cognito::ManagedLoginBranding", 1);
      template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
        GenerateSecret: true,
        AllowedOAuthFlows: ["code"],
        AllowedOAuthFlowsUserPoolClient: true,
        // The resource server's scope alone: no `openid`, so no ID token and no email (A-11).
        AllowedOAuthScopes: [{ "Fn::Join": ["", [Match.anyValue(), "/graph"]] }],
        CallbackURLs: [
          { "Fn::Join": ["", ["https://", parameter("AppDomainName"), "/auth/callback"]] },
        ],
        LogoutURLs: [{ "Fn::Join": ["", ["https://", parameter("AppDomainName"), "/"]] }],
        ExplicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH"],
        PreventUserExistenceErrors: "ENABLED",
        EnableTokenRevocation: true,
        AccessTokenValidity: 15,
        RefreshTokenValidity: 1440,
        SupportedIdentityProviders: ["COGNITO"],
      });
      expect(JSON.stringify(template.findResources("AWS::Cognito::UserPoolClient"))).not.toMatch(
        /RefreshTokenRotation/,
      );
    },
  );
});
