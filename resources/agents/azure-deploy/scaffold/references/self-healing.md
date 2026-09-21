# Self-Healing Loop — Error Classification & Auto-Fix

Step 11 validates generated IaC via CLI (`az bicep build` + `az deployment sub what-if`). On failure, classify each error and apply strategy below. Max 3 attempts before diagnosis (explain pattern → propose fix → ask user). After approval, ask after 5 more attempts, then every 5. See scaffold instructions.md § Self-Healing Loop for full escalation.

| Error Type | Class | Auto-Fix Strategy |
|------------|-------|-------------------|
| Invalid property name | FIXABLE | Replace with correct property from schema summary |
| Syntax error (HCL/Bicep) | FIXABLE | Re-generate affected module from reference patterns |
| Missing required property | FIXABLE | Add with default value from MCP best practices |
| Wrong API version | FIXABLE | Update to version from schema result |
| Provider version conflict | FIXABLE | Update `required_providers` block |
| Undeclared variable | FIXABLE | Add declaration to `variables.tf` |
| Policy-blocked SKU | FIXABLE | Substitute with next-best from `rejectedAlternatives[]` |
| Circular dependency | FIXABLE | Refactor module references — break cycle |
| Permission/RBAC insufficient | BLOCKING | Surface required role + `az role assignment create` command |
| State backend inaccessible | BLOCKING | Surface `az storage account create` instructions |
| Region unsupported for resource | BLOCKING | Suggest alternate regions — requires user decision |
| Quota exhaustion (ALL tiers in ALL regions) | PLAN_LEVEL_CHANGE | ⛔ Service pivot required — see scaffold instructions.md § Self-Healing Loop. Update `prepare-plan.json` → present re-approval gate → regenerate IaC. Counts as 1 healing attempt |
| Quota exhaustion (single region) | PLAN_LEVEL_CHANGE | ⛔ Region pivot required — read `prepare-plan.json.quotaValidation.checkedRegions` and `failedResources` to skip already-failed regions. After checking new regions, append results back to these fields. See scaffold instructions.md § Self-Healing Loop. Update plan region → present re-approval → regenerate IaC |
| Policy blocks planned service entirely | PLAN_LEVEL_CHANGE | ⛔ Alternative service required — see scaffold instructions.md § Self-Healing Loop. Map next-best from `rejectedAlternatives[]` → present re-approval → regenerate IaC |
