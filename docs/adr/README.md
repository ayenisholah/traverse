# Architecture decisions

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-cosmo-cloud-control-plane.md) | Use Cosmo Cloud with a self-managed router | Accepted |
| [0002](0002-ecs-fargate.md) | Run services on ECS Fargate | Accepted |
| [0003](0003-cdk-infrastructure.md) | Define infrastructure in CDK TypeScript | Accepted |
| [0004](0004-github-actions-oidc.md) | Deploy from GitHub Actions through OIDC | Accepted |
| [0005](0005-regional-waf-without-cloudfront.md) | Use a regional WAF without CloudFront | Accepted |
| [0006](0006-cloudwatch-dashboards.md) | Use CloudWatch for dashboards | Accepted |
| [0007](0007-nextjs-web-app.md) | Build the web app with Next.js | Accepted, product scope replaced by 0009 |
| [0008](0008-frox-design-system.md) | Adopt Frox after a licence check | Superseded by 0010 |
| [0009](0009-graph-workbench.md) | Build a graph workbench for frontend developers | Accepted |
| [0010](0010-tailwind-radix-frox-scale.md) | Use Tailwind and Radix with the Frox scale | Accepted |
| [0011](0011-sandbox-router.md) | Run a separate sandbox router | Accepted |
| [0012](0012-bedrock-assistant.md) | Use Amazon Bedrock for an optional assistant | Accepted |
| [0013](0013-real-data.md) | Serve real data | Accepted |
| [0014](0014-bundled-cli-on-npm.md) | Publish the CLI as a dependency-free bundle | Accepted |
| [0015](0015-anonymous-public-reads.md) | Allow anonymous reads on the public router | Accepted |
| [0016](0016-subgraph-kit.md) | Build subgraphs on GraphQL Yoga and @apollo/subgraph | Accepted |
| [0017](0017-literal-router-config.md) | Write every risky router setting out, and hold the router's environment to a list | Accepted |
