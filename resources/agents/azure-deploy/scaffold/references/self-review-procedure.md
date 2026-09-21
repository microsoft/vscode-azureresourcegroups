# Self-Review Procedure — Step 9

Sub-agent adversarial L1–L4 review of generated IaC.

## Sub-Agent Setup

Dispatch a sub-agent with:
- All generated IaC contents (every .bicep or .tf file from Step 5)
- The `prepare-plan.json` services/naming/deploymentVariables sections
- The `scaffold-manifest.json.files[]` list
- The full content of [self-review-checklist.md](self-review-checklist.md) AND [waf-checklist.md](waf-checklist.md) verbatim

## Sub-Agent Prompt

> "Follow self-review-checklist.md procedures for EACH L1–L4. Rate every finding VERIFIED | PLAUSIBLE | FLAGGED. Check: L1 Security (RBAC scope, network rules, managed identity, Key Vault; IaC and plan contradictions), L2 Pattern (anti-patterns, supporting resources; verify every scaffold-manifest.json.files[] file exists and is non-empty, FLAGGED otherwise), L3 Hallucination (resource names exactly match prepare-plan.json.naming, real API versions, SKU names match plan, no invented resource types), L4 WAF (use waf-checklist.md; Reliability, Security, Cost, Ops, Performance per service). Never fabricate; check each claim against provided IaC. Return: { findings: [{ layer: 'L1'|'L2'|'L3'|'L4', claim: '...', rating: 'VERIFIED'|'PLAUSIBLE'|'FLAGGED', detail: '...' }], summary: 'N/N VERIFIED, N PLAUSIBLE, N FLAGGED' }. ≤1000 tokens."

## Consume Results

- Any FLAGGED → fix IaC, re-run validation (`az bicep build`, `az deployment sub what-if`)
- If all VERIFIED/PLAUSIBLE → proceed to Step 10
- Write findings to `scaffold-manifest.json.selfReview`

> ⛔ **Self-review is COMPLETE after L1–L4.** L3 may use `mcp_bicep_get_bicep_file_diagnostics`, `az bicep build`, or `az deployment sub what-if` to catch errors early. **Step 12 remains mandatory regardless of findings** — IaC may change during Steps 9–12 (FLAGGED fixes); Step 12 writes contractual `validationResult` to manifest.

> ⛔ **Halt on critical self-review failures** — any selfReview FLAGGED at L1 (Security) or L3 (Hallucination): do NOT deploy. Present findings; ask **"Fix / Continue with risks / Cancel"**.
