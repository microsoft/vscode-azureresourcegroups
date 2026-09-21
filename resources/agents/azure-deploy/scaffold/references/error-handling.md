# Error Handling — Scaffold Phase

| Error | Remediation |
|-------|-------------|
| `prepare-plan.json` missing | Trigger prepare backfill via `azure-app-onboard`; never generate IaC without plan. |
| Existing Azure IaC (`.bicep`, `azure.yaml`, or `.tf` with `azurerm` provider) | ⛔ Never delete/overwrite; move to mirrored `.copilot-azure/sessions/<id>/replaced-files/`, tell user original backup location, then scaffold. |
| Existing non-Azure IaC (`.tf` with GCP/AWS provider) | Generate Azure TF alongside; see [terraform-patterns.md § Non-Azure IaC coexistence](terraform-patterns.md). Do NOT halt. |
| MCP tool unavailable | Use reference patterns. Flag IaC "unverified against best practices." |
| Self-review finds FLAGGED items | Add to `scaffold-manifest.json.selfReview.findings[]`; surface at approval gate. |
| Self-healing exhausted (3 attempts) | Pause auto-healing. Diagnose: (1) error pattern, (2) specific next fix, (3) ask "Yes, try that" / "I have a suggestion" / "Stop." If continuing, auto-heal 5 more, then ask every 5. If stopped, write `validationResult` with `status: "Failed"` and all errors. Do NOT deploy. |
| Schema summary exceeds token limit | Compress each schema to ≤500 tokens via sub-agent pattern. |
| `context.json` malformed | Halt. Report: "Session state corrupted — consider starting a fresh session." |
