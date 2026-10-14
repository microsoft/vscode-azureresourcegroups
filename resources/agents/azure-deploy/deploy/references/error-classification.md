# Error Classification

Typed error classification and causal retry rules for deploy-time failures.

## Multi-Error Triage

> ⛔ When 3+ errors, classify ALL before fixing ANY. Group by root cause. Present: "Deploy failed with {N} errors from {M} root causes."

## Categories

### `CONTRACT_ERROR` — Return to the Owning Phase

Malformed, incomplete, legacy, or mismatched deployment contracts and preflight artifacts are not retryable
deployment failures. Return to prepare/scaffold/integration, repair the owning artifact, rerun its validators,
and generate a new contract. Never patch a target, component list, validator, or acceptance requirement during
deploy.

### `IAC_ERROR` — Route Back to Scaffold

| Example | Fix |
|---------|-----|
| Invalid property name | Call `mcp_bicep_build_bicep` with `{ filePath: "infra/main.bicep" }` for structured error details, then fix. Fallback: `az bicep build` |
| Wrong SKU for region | Substitute from `rejectedAlternatives[]` |
| Missing required field | Call `mcp_bicep_build_bicep` for structured error, fix from diagnostics. Fallback: `az bicep build` |
| Policy violation | Substitute per policy |
| API version not found | Call `mcp_bicep_list_az_resource_types_for_provider` with `{ providerNamespace: "..." }`. Use latest GA — no `-preview`. Fallback: `az provider show` |
| `listKeys()` in output | ⛔ Security risk — replace with managed-identity access (no shared keys, no Key Vault) |
| Redis `InvalidRequestBody` for `properties.sku.name` | Bicep type issue — create via `az redis create --sku Basic --vm-size c0`, switch Bicep to `existing` keyword |

**Flow:** Deploy → classifies IAC_ERROR → scaffold self-healing → re-validate → retry.

### `APPLICATION_ERROR` — Repair Source or Package

Use for deterministic code, build, package, startup, migration, endpoint, dependency-access, or correlation
failures. Repair the owning source/specification, run focused tests, rebuild the immutable artifact, and rerun
the applicable contract validators. A retry is allowed only when `retryDecision.disposition` is
`changed-repair` and `inputChanges[]` contains before/after SHA-256 evidence for the changed deployable input.

### `INFRA_TRANSIENT` — Retry with Backoff

| Example | Strategy |
|---------|----------|
| ARM 429, 409 conflict, RBAC delay, network timeout | 30s → 60s → 120s (3 max) |
| Container Apps `Operation expired` | Check root cause first: port mismatch → `IAC_ERROR`; bad image/package or app crash → `APPLICATION_ERROR` and a changed rebuild; preserved registry/RBAC propagation evidence → `INFRA_TRANSIENT`. |

After 3 failures → escalate to user.

An unchanged retry is allowed only for this classification, only with
`retryDecision.disposition: "proven-transient"`, and only when `transientEvidencePaths[]` proves the platform
condition (for example an ARM 429 response or documented RBAC propagation delay). A timeout without preserved
command/platform evidence is `UNKNOWN`, not transient.

### Migration job failures — evidence before classification

For a one-shot migration job, the job-controller reason is not the application cause.
`BackoffLimitExceeded` with `replicaRetryLimit: 0` proves only that one process exited nonzero and no retry
was permitted. Before choosing `IAC_ERROR`, `INFRA_TRANSIENT`, or `ENVIRONMENT_BLOCKING`, follow
[`migration-access.md` § Tier-2 execution evidence and retry gate](../../cor-references/migration-access.md):
persist application stdout/stderr and exit code, controller/replica status, migration-history and expected
table state, and the migration principal/OID plus token connectivity. Missing application logs means
`UNKNOWN` and blocks an unchanged retry. A logged transient with coherent unapplied state permits at most
one unchanged retry; a deterministic code/package/configuration cause requires repair and revalidation.

### `ENVIRONMENT_BLOCKING` — Surface to User

| Example | Action |
|---------|--------|
| 403 on sub-scope deploy | ⛔ Try [403 Scope Fallback](deploy-safety.md) first (RG-scope). Only block if retry also fails |
| 403 on RG-scope | Surface: `az role assignment create --role Contributor --assignee {objectId} --scope {rg}` |
| AuthorizationFailed / deny assignment | Get user objectId, suggest role assignment command. Deny assignments → contact admin |
| Quota exhausted | ⛔ PLAN_LEVEL_CHANGE — HALT, present region fallback with re-approval |
| Region doesn't support resource | ⛔ PLAN_LEVEL_CHANGE — same as quota |
| `LocationIsOfferRestricted` | ⛔ PLAN_LEVEL_CHANGE — read `quotaValidation.offerRestrictions[]` for unblocked regions |
| MI sidecar OOM on F1/B1 | Upgrade SKU, remove MI, or switch to Container Apps |
| AADSTS530084 / TF auth failure | Re-scaffold as Bicep + `az deployment group create`. Never fall back to imperative CLI |

### `UNKNOWN` — Preserve Evidence and Stop

Use when the root cause cannot be established from preserved application, controller, Azure, and state
evidence. `UNKNOWN` is never retryable. Capture inventory, write the failed first-pass/final artifacts, and
surface the missing evidence or next diagnostic action to the user.

> ⛔ **During ALL healing: NEVER run `az group delete`, `az postgres flexible-server delete`, `az redis delete`, `az webapp delete`, or any destructive resource deletion.** Track failed RGs in `deploy-result.json.orphanedResourceGroups[]` instead. The user deletes at handoff. If you need a clean region retry, use a NEW RG name (append `-2`) — do NOT delete-and-recreate. ⛔ **After each failed/healing `az deployment`, run the selected product inventory provider in `capture` mode, passing every resource-group scope including the abandoned one,** so orphaned resources from the healing retry are recorded deterministically rather than left for you to remember.

## Healing Trace

Before any retry, compare the normalized failure fingerprint with prior attempts:

1. Record `failureFingerprint` and existing workspace-relative `evidencePaths[]`.
2. Choose a typed `repairKind`.
3. For deterministic failures, require `retryDecision.disposition: "changed-repair"` and at least one
   `inputChanges[]` entry with the artifact, description, evidence path, and before/after SHA-256. Never record
   secret values.
4. For `INFRA_TRANSIENT`, an unchanged retry requires
   `retryDecision.disposition: "proven-transient"` and non-empty `transientEvidencePaths[]`.
5. Otherwise set `disposition: "not-retried"` and stop. The same fingerprint with neither changed inputs nor
   proven transient evidence must not execute again.

Log the complete typed attempt to `deploy-result.json.healingAttempts[]` using
[`deploy-schemas.ts`](deploy-schemas.ts). The contract caps total healing attempts at three; a plan-level
change still requires re-approval and a regenerated scaffold contract.

> ⛔ **Repeat failure (same error 2+):** Read [iac-resources.md](../../references/iac-resources.md) § Deploy Troubleshooting and `fetch_webpage` the matching URL.

After 3 failed cycles: write `partial: true`, surface remaining errors. Do NOT auto-rollback.

## Known Platform Bugs / Deploy Timing

See [`pipeline-rules-runtime.md`](../../references/pipeline-rules-runtime.md).
