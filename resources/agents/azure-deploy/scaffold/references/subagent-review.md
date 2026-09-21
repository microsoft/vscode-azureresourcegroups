# Subagent Template — Security + Adversarial Review (Steps 6–9)

Review generated IaC security and correctness. Each workflow step names required reference and checks.

## Critical Rules

- ⛔ **Do NOT invoke other agents or hand off** — no external agent calls. Use THIS file only.
- ⛔ **Do NOT run `az deployment` commands** — review is read-only analysis of generated files.
- ⛔ **Do NOT modify IaC files** — report findings only. The caller fixes issues.

## Input (provided by caller)

| Field | Required |
|-------|----------|
| All generated IaC file contents (every `.bicep` or `.tf` file) | YES |
| `prepare-plan.json` — services (service types, SKUs), naming, deploymentVariables sections | YES |
| `scaffold-manifest.json.files[]` list | YES |
| `prereq-output.json.warnings[]` — all prereq warnings that require IaC fixes | YES |

## Output

Return JSON (≤1000 tokens):
```json
{
  "findings": [
    { "layer": "L1|L2|L3|L4", "file": "modules/app.bicep", "claim": "...", "rating": "VERIFIED|PLAUSIBLE|FLAGGED", "detail": "..." }
  ],
  "summary": "N/N VERIFIED, N PLAUSIBLE, N FLAGGED"
}
```

## Workflow

### Step 1 — Read security patterns + run L1 security baseline

Read [bicep-patterns-security.md](bicep-patterns-security.md) and [rbac-roles.md](rbac-roles.md).

**Do:** Check every generated IaC file against ALL reference security checks: FLAGGED conditions, edge cases, Bicep patterns. Do NOT rely on memory; use reference as checklist.

### Step 2 — Read checklist + run L2–L4 adversarial review

Read [self-review-checklist.md](self-review-checklist.md).

**Do:** First run the **cross-module reference trace** from the checklist's § Cross-Module Reference Validation: parse every `module` call in `main.bicep`, read each target module's `param`/`output` declarations and `secrets[]` entries, then verify every reference resolves (params passed match params declared, outputs referenced exist, every CA `secretRef` has a matching native `secrets[]` entry — ⛔ NO `keyVaultUrl` / Key Vault). Then run L2–L4:
- **L2 (Pattern Validation):** File structure matches `main.bicep` → `modules/*.bicep`, naming follows plan, Container Apps uses two-phase wiring, every `files[]` entry exists on disk, no `azure.yaml`, cross-module references all resolve
- **L3 (Hallucination Detection):** Resource names match `naming.resources[]` exactly, API versions are real (verify via `az bicep build`), SKU names match plan, no invented resource types
- **L4 (WAF Alignment):** Check per-pillar:
  - Reliability: zone redundancy (prod SKUs), health probes, GRS storage, min replicas ≥1
  - Security: managed identity, on-compute app-internal secrets (no Key Vault), HTTPS+TLS 1.2, no public blob, no `administratorLogin`
  - Cost: SKU matches budget, scale-to-zero for dev/test CA, free grants applied
  - Ops: App Insights, 5 AppOnboard tags, all values parameterized
  - Performance: autoscale (prod), CDN for SPA, connection pooling, cache tier

### Step 3 — Compile findings + return

**Do:** Merge L1–L4 into findings JSON. Rate per [self-review-checklist.md](self-review-checklist.md) § Rating System: VERIFIED (confirmed), PLAUSIBLE (unverified without counter-evidence), FLAGGED (contradicted or critical pattern missing). ⛔ L1 or L3 FLAGGED → caller must fix before deploy. Return results.
