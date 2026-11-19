# 0024: Record the edge in the WAF's log, not load balancer access logs

**Status:** Accepted

## Context

SPEC listed access logs as part of the load balancer. A load balancer access log records each request line, query string included, and can't redact anything. The public router serves reads sent as GET, with variables in the query string (C-55), and sign-in returns to `/auth/callback?code=…&state=…`. Access logs would therefore keep GraphQL variables and authorization codes, which GR-4 forbids. The WAF sees every request before the load balancer does, and its log can redact headers and the query string.

## Decision

- The load balancer keeps no access logs. cdk-nag's `AwsSolutions-ELB2` is accepted in the reviewed list with this reason.
- The WAF logs the requests it blocked or counted to a KMS-encrypted log group for 30 days, with the `authorization`, `cookie` and `referer` headers and the query string redacted. A page's query string comes back in the next request's `Referer`, so that header goes too. It keeps no sampled requests, which aren't redacted.

## Consequences

- No record of what the load balancer itself did, such as target response times or which target answered. Those come from load balancer metrics and from M8's telemetry.
- Requests the WAF lets through leave no record at the edge.
- A blocked or counted request's record still holds the client's address, which GR-4 counts as personal data. The owner decides whether a month of them stands; DATA_PRIVACY lists the log.
- If a later feature needs load balancer access logs, it must first make sure no query string can carry user data, for example by refusing GET with a query string at the edge.
