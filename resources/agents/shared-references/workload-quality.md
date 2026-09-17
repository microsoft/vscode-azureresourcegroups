# Workload Quality Contract

Application-level controls derived from the approved `Quality Attributes & Tradeoffs` section in
`.azure/project-plan.md`.

> **Reference:** [Azure Well-Architected Framework](https://learn.microsoft.com/azure/well-architected/what-is-well-architected-framework)
> and [the five pillars](https://learn.microsoft.com/azure/well-architected/pillars). This contract applies
> workload requirements to generated code. It is not a score, certification, or substitute for the full
> Azure Well-Architected Review.

## Boundaries

1. **The plan is authoritative.** Scaffold implements the approved quality targets; it does not choose Azure
   services, SKUs, regions, redundancy, networking, or disaster-recovery topology. Deployment owns those
   decisions.
2. **Security and correctness are floors, not tradeoffs.** `Lowest Cost` and `Lowest Latency` never disable
   authorization, validation, managed-identity boundaries, secret hygiene, data integrity, or safe logging.
3. **Do not invent numerical targets.** A missing availability, RTO, RPO, throughput, or latency target stays
   an explicit deferred risk for deployment planning.
4. **Do not claim WAF compliance.** Record implemented controls, evidence, planned validation, and unresolved
   risks. Never write `WAF compliant`, `WAF certified`, or `100% WAF aligned`.
5. **No speculative dependencies.** Do not add Redis, a queue, CDN, premium library, or load-test product just
   because a pillar mentions one. Use the services and package ecosystem already approved in the plan.

## Baseline controls — every profile

| ID | Pillar | Required application behavior | Required evidence |
|----|--------|-------------------------------|-------------------|
| `REL-HEALTH-01` | Reliability | The health endpoint reports Essential and Enhancement dependency health and distinguishes healthy, degraded, and unhealthy behavior. | Health handler + tests for full health, enhancement failure, and essential failure. |
| `REL-TIMEOUT-01` | Reliability | Every outbound HTTP/SDK operation has a finite timeout or uses an SDK client whose timeout is explicitly configured. | Shared timeout/client configuration + timeout test. |
| `REL-RETRY-01` | Reliability | Retry only documented transient failures, use bounded exponential backoff with jitter, and never automatically retry a non-idempotent write. | Shared retry policy + tests for retryable, non-retryable, and exhausted cases. |
| `REL-DEGRADE-01` | Reliability | Enhancement failures use a typed fallback; Essential failures return a structured error instead of fabricated success. | Essential/Enhancement inventory + handler tests. |
| `SEC-INPUT-01` | Security | Every external input is validated before use; authentication and authorization follow the plan's API Login setting. | Validation schemas + positive/negative route tests. |
| `SEC-LOG-01` | Security | Logs never include credentials, tokens, request bodies, or sensitive field values. | Central redaction/allowlist policy + log-capture test. |
| `COST-SCOPE-01` | Cost Optimization | Generated code uses only approved dependencies and services; optional work is not performed when its feature is disabled. | Dependency/service inventory + disabled-feature test where applicable. |
| `OE-CORRELATION-01` | Operational Excellence | Every request gets or preserves a correlation ID; structured logs include it with operation, status, and duration. | Request middleware + log-capture test. |
| `OE-ERROR-01` | Operational Excellence | Errors are structured, actionable, and do not expose implementation details. | Shared error contract + route tests. |
| `PE-BOUNDS-01` | Performance Efficiency | Collection routes and variable-size inputs have explicit pagination, item, and payload bounds; concurrency is bounded. | Validation schema/config + boundary tests. |

Reuse the existing runtime-specific patterns. One shared timeout, retry, correlation, and redaction utility per
service is better than copies in every handler.

## Profile-specific controls

### Operating Profile

| Answer | Additional scaffold behavior |
|--------|------------------------------|
| `Development / Demo` | Implement the baseline and test it. Do not manufacture production availability or DR claims. Keep production-only gaps explicit in the handoff. |
| `Standard Production` | Add dependency-failure tests for every Essential dependency; assess mutation endpoints for idempotency; ensure logs and health output provide enough context to diagnose a failed request without sensitive data. |
| `Business-Critical` | Apply all Standard Production controls. Require failure-mode tests for every Essential dependency and explicit evidence for safe retry/idempotency boundaries. Record missing availability/RTO/RPO values as deployment blockers; application scaffolding cannot satisfy them by itself. |

### Data Classification

| Answer | Additional scaffold behavior |
|--------|------------------------------|
| `Public` | Apply the baseline. Public data does not make credentials, internal errors, or write authorization public. |
| `Internal` | Do not log full request/response bodies. Redact identifiers not needed for diagnosis. |
| `Confidential / Personal` | Authorization defaults to deny for private resources. Add cross-user/tenant negative tests. Logs use an allowlist and tests prove representative personal fields are absent. |
| `Regulated` | Apply Confidential/Personal controls. Emit structured audit events for authentication and sensitive state changes without logging sensitive values. Record compliance, retention, residency, and private-networking review as unresolved unless explicitly supplied. |

### Traffic Profile

| Answer | Additional scaffold behavior |
|--------|------------------------------|
| `Small / Steady` | Baseline pagination and payload bounds are sufficient. |
| `Bursty` | Bound concurrent fan-out and queue work already present in the plan. Test overload/throttling behavior; return a structured `429`/retry signal rather than allowing unbounded work. |
| `High Volume` | Require pagination on every collection route, bounded batch sizes, pooled clients, and a stack-native load-test command that exercises the highest-volume route. |
| `Latency Sensitive` | Set explicit outbound timeouts, parallelize independent calls, avoid sequential N+1 access, and add a stack-native performance test. If no numerical target was approved, report that gap instead of inventing one. |

### Optimization Priority

| Answer | Tradeoff rule |
|--------|---------------|
| `Balanced` | Implement the plan without privileging one pillar beyond its stated targets. |
| `Lowest Cost` | Avoid speculative services and background work; never weaken the security/correctness baseline. |
| `Highest Reliability` | Prefer explicit failure handling, idempotency, and deeper failure-mode tests; deployment still owns redundancy and DR. |
| `Lowest Latency` | Prefer bounded parallelism and lean response shapes; never skip validation, authorization, or durable writes. |

## Integration handoff contract

The scaffold agent writes a `## Workload Quality Contract` section in `.azure/integration-plan.md` with:

1. The four approved workload answers, copied exactly from the project plan.
2. An **Application Controls** table with columns:
   `ID | Pillar | Control | Evidence | Integration Validation`.
3. At least one concrete row for each of the five pillars. Use the stable IDs above where applicable.
4. Real evidence paths/symbols and executable validation commands—never `implemented`, `done`, or a prose
   promise with no evidence.
5. Every unresolved production, compliance, recovery, or numerical target under **Deferred Risks**.

The integrate agent preserves these controls while replacing mocks with live clients, runs each listed
integration validation, and appends the result. A live-data swap that removes timeouts, retry boundaries,
correlation, redaction, pagination, or authorization is a regression even when the app returns `200`.
