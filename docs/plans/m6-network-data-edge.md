# M6: Network, data and edge

**Needs:** [account setup](account-setup.md), and owner approval of the first deployment.

## Status

Built locally, as M4 and M5 were (owner, 2026-11-19): stacks are proven by synthesis, cdk-nag and assertions, and nothing is deployed. Traverse gets its own AWS account, so the stacks name none (ADR 0023). `feat/network-stack` is merged.

## Work

1. `feat/network-stack`: VPC across 3 zones, NAT, S3 gateway endpoint, flow logs.
2. `feat/data-stack`: Multi-AZ RDS, Multi-AZ ElastiCache with TLS and auth, versioned S3, KMS keys and secrets.
3. `feat/edge-stack`: certificate, load balancer, WAF, access logs, DNS, Cognito, budget alarms.

Staging deploys first, with a single NAT gateway.

## Exit

- `cdk diff` is clean and `cdk-nag` has no unreviewed suppressions.
- A CDK test rejects IAM users and access keys.
