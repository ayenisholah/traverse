# M7: Services on staging

## Work

1. `feat/graph-service-construct`: a reusable Fargate service with least-privilege roles, Service Connect and autoscaling.
2. `feat/router-service`: digest-pinned image in ECR, shutdown timing from the [specification](../../SPEC.md), Redis rate limits and S3 fallback. A CDK test passes the task definition's environment through `findUnsafeRouterEnvironment`, and `CONFIG_PATH` names `router/config.yaml` alone (ADR 0017). Health comes from the target group, because the image has no shell (C-39), and the load balancer idle timeout stays below the router's 60 seconds (C-38).
3. `feat/subgraph-services`: the three subgraphs, published to Cosmo Cloud.
4. `feat/migration-task`: one-off migration task.
5. `feat/web-service`: the web app on Fargate, using the same construct.

U-1 and the rest of U-13 are answered here.

## Exit

- An authenticated query over HTTPS on staging succeeds and appears in Studio.
