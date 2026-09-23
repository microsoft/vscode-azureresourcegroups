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
| `SEC-IDENTITY-01` | Security | Every Azure dependency is reached with the deployed identity and an operation that identity's granted role authorizes — including the health probe. | Dependency access row per dependency + a test that fails when operation and permission disagree. |
| `COST-SCOPE-01` | Cost Optimization | Generated code uses only approved dependencies and services; optional work is not performed when its feature is disabled. | Dependency/service inventory + disabled-feature test where applicable. |
| `OE-CORRELATION-01` | Operational Excellence | Every request accepts a valid `X-Correlation-ID` or generates a new one, replaces invalid values, returns the ID on success and error responses, exposes it through CORS, and includes it in structured logs with operation, status, and duration. | Request middleware + success/error/CORS route tests + log-capture test. |
| `OE-ERROR-01` | Operational Excellence | Errors are structured, actionable, and do not expose implementation details. | Shared error contract + route tests. |
| `PE-BOUNDS-01` | Performance Efficiency | Collection routes and variable-size inputs have explicit pagination, item, and payload bounds; concurrency is bounded. | Validation schema/config + boundary tests. |

Reuse the existing runtime-specific patterns. One shared timeout, retry, correlation, and redaction utility per
service is better than copies in every handler.

### Executable correlation contract

`OE-CORRELATION-01` is an exit gate, not a middleware-presence check. Use one centralized implementation per
service and require tests that prove:

1. A valid incoming `X-Correlation-ID` (`[A-Za-z0-9._:-]`, 1–128 characters) is preserved exactly.
2. A missing ID generates a non-empty valid ID; an invalid/oversized ID is replaced, not reflected.
3. Both a successful request and a structured validation error return `X-Correlation-ID`.
4. Browser-facing APIs include `X-Correlation-ID` in `Access-Control-Expose-Headers` for the exact approved
   origin.
5. One captured request log contains the same ID plus operation/route template, status, and duration, without
   request bodies or sensitive values.

Deployment re-runs the HTTP portion against the released endpoint with
`azure-deploy/deploy/scripts/verify-correlation-contract.mjs`. A healthy platform response with a missing
correlation header is a failed application release.

⛔ **Evidence must cover every service the control spans.** A control that reaches the browser — bounded inputs,
error and retry UI, no sensitive values in browser logs, correlation preserved across the seam — is not evidenced
by backend tests alone. When the plan has a frontend, its controls carry frontend-level evidence too; a project
with comprehensive API tests and no frontend test has evidenced half of what it claims.

## Dependency access contract — `REL-HEALTH-01` and `SEC-IDENTITY-01`

A control that is green locally and 403 in Azure has not been implemented; it has been deferred without saying so.
Local emulators (Azurite, a container database) authenticate with a connection string that carries **every**
permission, so an operation the deployed managed identity is not authorized to call still passes every local test.
The mismatch only surfaces after provisioning, as a degraded health endpoint.

So every Essential and Enhancement dependency carries an access row, and the operation named in that row is the
operation the code actually calls:

| Field | Meaning |
|-------|---------|
| Dependency | The service, as named in the plan's Services table. |
| Operation | The exact SDK call the app makes against it, including its health probe. |
| Deployed identity | Which identity presents the credential in Azure — the app's managed identity unless the plan says otherwise. |
| Required permission | The built-in role or data action that authorizes that operation for that identity. |
| Local equivalent | The emulator/connection-string path, stated so the difference is visible rather than assumed away. |

⛔ **Pick the probe from what the granted role authorizes, not from what the SDK exposes.** Data-plane roles grant
`dataActions` only. A service-level *management* read is not among them, so a probe that calls one fails under
exactly the least-privilege identity the security baseline requires:

| Dependency | ✅ Probe authorized by the data role | ⛔ Probe that 403s under a data-only role |
|------------|--------------------------------------|------------------------------------------|
| Blob Storage | List containers, one page — `containers/read` is a `dataAction` in Storage Blob Data Contributor/Reader | Get Blob Service Properties — needs `Microsoft.Storage/storageAccounts/blobServices/read`, an `action` the data roles do not carry |
| Queue Storage | Peek/list queues — `queues/read` | Get Queue Service Properties |
| PostgreSQL / MySQL / SQL | `SELECT 1` as the mapped database principal | Any server- or subscription-level management call |
| Cosmos DB | A data-plane read through the SQL role assignment | `ReadAccountAsync` under ARM RBAC only |

Keep the [service-level rule](runtimes/dotnet.md) too: probe the account/namespace, never a child resource the app
creates lazily. The two rules together mean *service-level **and** authorized by the granted data role*.

**Evidence** is the row plus a test that fails when the operation and the permission disagree. **Deployment
validation** is the same probe executed against the deployed identity after role propagation — that, not a local
pass, is what closes the control.

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
6. A **Dependency Access** table with columns:
   `Dependency | Operation | Deployed identity | Required permission | Local equivalent`.
   One row per Essential and Enhancement dependency, using the operation the code actually calls. This is the
   row deployment reads to choose the role it assigns, so a dependency missing here is a dependency whose
   deployed identity is being guessed at.

The integrate agent preserves these controls while replacing mocks with live clients, runs each listed
integration validation, and appends the result. A live-data swap that removes timeouts, retry boundaries,
correlation, redaction, pagination, or authorization is a regression even when the app returns `200`.

## What deployment owes back

Deployment owns topology, and these rows are what let it own topology *without re-deriving intent*:

| Integration wrote | Deployment must |
|-------------------|-----------------|
| Dependency Access rows | Assign exactly the named permission to the named identity, then re-run each probe against the deployed identity **after role propagation**. A probe that is not re-run is a control that was verified only against an emulator. |
| Application Controls | Re-verify each live and record `PASS`, `FAIL`, or `DEFERRED` with the deployed evidence — never carry the integration result forward as if it were a deployment result. |
| Deferred Risks | Keep unresolved risks unresolved. Deployment may close one only with real evidence; it may never silently drop one. |

⛔ A deployment that changes application source to make a control pass has changed the thing under test. Fix the
role, the ordering, or the probe named in the contract instead, and record the change as a healing attempt.
