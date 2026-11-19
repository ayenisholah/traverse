# M6: Network, data and edge

**Needs:** [account setup](account-setup.md), and owner approval of the first deployment.

## Status

Built locally, as M4 and M5 were (owner, 2026-11-19): stacks are proven by synthesis, cdk-nag and assertions, and nothing is deployed. Traverse gets its own AWS account, so the stacks name none (ADR 0023). `feat/network-stack`, `feat/data-stack` and `feat/edge-stack` are merged, which finishes the build. The exit checks pass locally: `cdk synth` of both environments is clean and offline, cdk-nag has no unreviewed acknowledgements, and a test rejects IAM users and access keys. `cdk diff` against the real account waits for it.

## Work

1. `feat/network-stack`: VPC across 3 zones, NAT, S3 gateway endpoint, flow logs.
2. `feat/data-stack`: Multi-AZ RDS, Multi-AZ ElastiCache with TLS and auth, versioned S3, KMS keys and secrets.
3. `feat/edge-stack`: certificate, load balancer, WAF, access logs, DNS, Cognito, budget alarms.

Staging deploys first, with a single NAT gateway.

## Exit

- `cdk diff` is clean and `cdk-nag` has no unreviewed suppressions.
- A CDK test rejects IAM users and access keys.

## Deploying staging

Needs the owner's approval, and an account that can use both eu-north-1 and us-east-1 (U-7, A-7):

1. Create Traverse's own account, delegate the subdomain to a Route 53 hosted zone, and bootstrap CDK in eu-north-1 and us-east-1.
2. `cdk diff`, then deploy `traverse-budgets` with `--parameters AlertEmail=…`. It's the account's, shared by every environment, and every other stack depends on it, so alerts exist first (NFR-6). Confirm the email subscription.
3. Deploy `traverse-staging-network`, then `traverse-staging-data`, then `traverse-staging-edge` with `AppDomainName`, `RouterDomainName`, `HostedZoneId` and `AuthDomainPrefix`.
4. Prove FR-GW-6 with a request the rate rule or a managed rule blocks, and answer U-24 and U-26.

## On the first deployment

Check what synthesis can't:
- cross-stack values arrive through `Fn::GetStackOutput` (A-23);
- the Valkey group is created with `TransitEncryptionMode: required` (U-24);
- RDS writes into the log groups CDK made (A-25, U-24).
