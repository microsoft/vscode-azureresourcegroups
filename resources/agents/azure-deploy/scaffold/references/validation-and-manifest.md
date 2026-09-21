# Validation, Manifest & Approval — Steps 10–12.5

## Step 10 — CI/CD

Do NOT auto-generate workflows or create branches/PRs. Scaffold writes only IaC. Activate only when `context.json.repo.remote` is non-null AND user explicitly requests branch/PR creation. If `repo.remote` absent or user declines, write IaC to working tree. For requested CI/CD, or post-deploy follow-up, call `mcp_azure_mcp_deploy` → `deploy_pipeline_guidance_get` with `is-azd-project: false`, `pipeline-platform: "github-actions"`, `deploy-option: "provision-and-deploy"`; present guidance for user application.

## Step 11 — Validate Generated IaC

> ⛔ **Validate BEFORE writing manifest.** Manifest requires `validationResult`; do NOT write `scaffold-manifest.json` first.

> ⛔ Do NOT call other agents during scaffold/deploy — see [pipeline-rules.md](../../references/pipeline-rules.md).

Run directly; all must pass.

**11a. Bicep compilation:**
```powershell
az bicep build --file infra/main.bicep --stdout > $null
```
(Bash: use `/dev/null`, not `$null`.) Compiled ARM JSON is discarded; diagnostics remain on **stderr**. Read stderr, not only exit code.

> ⛔ **Exit 0 does NOT prove validity.** `az bicep build` exits 0 with `Warning BCP*` diagnostics indicating broken intent. On bicep 0.46.1, resource missing required `location`, `sku`, `kind` compiles with **exit 0** and only `Warning BCP035`. Trusting exit code ships resource without SKU as validated.

**Pass criteria — all three must hold:**

| Signal | Verdict |
|---|---|
| Non-zero exit, or any `Error BCP*` | **Fail** — fix and retry |
| `Warning BCP*` (e.g. `BCP035` missing required property, `BCP036` wrong property type) | **Fail** — fix and retry |
| `BCP081` "does not have types available" | **Advisory only** — see below |
| Linter warnings (`no-unused-params`, `prefer-interpolation`, …) | Pass — do not block |

`BCP081` is exempt because bicep's bundled type index lags ARM and flags real current API versions. It cannot separate invented from newer resource types. Read but do not fail it; genuine misspelling remains a bug.

Fail: fix errors and retry.

**11b. Static RBAC review** — check generated Bicep assignments per [rbac-roles.md](rbac-roles.md). Every managed identity ↔ resource pair requires `Microsoft.Authorization/roleAssignments` with correct role GUID.

**11c. Write `validationResult`** — after all checks pass, write:
```json
{
  "validationResult": {
    "status": "Validated",
    "checks": [
      { "name": "bicep build", "passed": true, "detail": "<the command you ran and what it reported>" },
      { "name": "RBAC review", "passed": true, "detail": "<which identity/resource pairs you checked>" }
    ]
  }
}
```

> ⛔ **Field names fixed; copy exactly.** `validationResult` MUST match `ValidationResult` in [`scaffold-schemas.ts`](scaffold-schemas.ts): `status` + `checks[]`; each check `{ name, passed: boolean, detail?: string }`.
> - `passed` is a **boolean** — not `"result": "PASS"`, not `"status"`.
> - The array is `checks` — not `notes`, `warnings`, or `errors`.
> - Do NOT use `ConformanceResult` (`{ passed, failures[], source }`) here. That is a **different type** for a different gate (the Step 3c plan-conformance script). `validationResult` is never shaped like it.
>
> ⛔ **`detail` describes actual observation** — run command and real output. Never copy placeholder or write a `detail` claiming unrun success.

**Terraform path:** Replace 11a with `terraform init -backend=false && terraform validate`.

- FIXABLE validation errors: edit IaC → re-run self-review (L1–L4) → re-validate (max 3). ⛔ **Read [scaffold-healing-rules.md](scaffold-healing-rules.md) before healing** for FIXABLE and BLOCKING classes and strategies.
- If BLOCKING errors remain after 3 attempts: surface to user and halt.

## Step 12 — Write `scaffold-manifest.json`

⛔ **Read [`scaffold-schemas.ts`](scaffold-schemas.ts)** for exact `ScaffoldManifest`. Write session file once after validation, populating ALL fields: `files[]`, `selfReview.findings[]`, AND Step 11 `validationResult`.

> ⛔ **Exit gate: `scaffold-manifest.json.validationResult` MUST NOT be null.** After validation: `{ status: 'Validated'/'Partial'/'Failed', checks: [{ name, passed, detail? }] }` per `ValidationResult` in [`scaffold-schemas.ts`](scaffold-schemas.ts). Null = incomplete.

**Also update `context.json`** per `AppOnboardContext` in [`session-schemas.ts`](../../references/session-schemas.ts): append `"scaffold"` to `completedPhases`, set `currentPhase` to `"deploy"`, update `lastModifiedUtc`.

## Step 12.5 — Deploy Approval Gate

Present generated files, selfReview findings, Step 11 **validation results** (pass/fail) per check, services + SKUs, secure defaults. End: **"Ready to deploy? (Yes / Run manually / Edit plan / Cancel)"**; wait for approval.

> ⛔ **Before deploy gate:** `scaffold-manifest.json` must contain `validationResult` with `status`. If NO, run Step 11. Never present with `validationResult: null`.

> ⛔ **Quota gate — MANDATORY.** Read `prepare-plan.json.quotaValidation`. If `verified == false`, `method == "unverifiable"`, or quota-constrained service `method` is not `"cli"`: follow [`sku-quota-validation.md`](../../prepare/references/sku-quota-validation.md) § Deploy Gate Re-Validation.
> ⛔ Do NOT use `az vm list-usage`, `az appservice list-locations`, or `mcp_azure_mcp_quota` for quota checks — see Anti-Patterns in [`sku-quota-validation.md`](../../prepare/references/sku-quota-validation.md).


> ⛔ **Azure compatibility warnings.** Read `prereq-output.json.warnings[]`; surface EACH `fixPhase: "deploy-gate"` at gate: "⚠️ Azure compatibility: {warning.summary}. Fix: {warning.fix}. Approve? (Yes / Skip / Cancel)". User skip → add to `postDeployRecommendations[]`.

> ⛔ **Phase exit — NOT complete until ALL done:**
> 1. `scaffold-manifest.json` written with `files[]`, `selfReview.findings[]`, AND `validationResult`
> 2. `context.json`: `"scaffold"` appended to `completedPhases`, `currentPhase` → `"deploy"`, `lastModifiedUtc` updated
> 3. `deploy-checklist.md` exists in session folder — parallel checklist subagent writes at scaffold Step 5b before IaC gen completes. Verify; if missing, write from [`deploy-checklist-template.md`](../../deploy/references/deploy-checklist-template.md), fill real `prepare-plan.json` values, delete unrelated compute sections.
