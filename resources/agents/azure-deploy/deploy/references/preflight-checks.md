# Preflight Checks

Pre-deployment validation steps. Run after user approval, before deployment execution.

> AppOnboard runs direct deployment (no `azd`).

## Check Sequence

Branch on `scaffold-manifest.json.iacFormat`:

### 0. Immutable artifact and runtime contract gate

Run this gate **before what-if, inventory baseline, or any resource-creating command**:

```text
node .github/agents/azure-deploy/deploy/scripts/validate-deployment-artifacts.mjs --session-path .copilot-azure/sessions/{sessionId} --infra-path infra --subscription {subscriptionId} --tenant {tenantId} --resource-group {resourceGroup} --region {region}
```

Save the JSON output as `deployment-artifact-validation.json`. Missing target fields identify a legacy artifact and fail closed: return to prepare/scaffold to regenerate
it. Do not patch strings in deploy. For Bicep, rerun the shipped `scaffold-conformance.ps1` (Windows) or
`.sh` (macOS/Linux) script against the final IaC and require PASS. For Terraform, require the validated
`azurerm` provider and exact `subscription_id`/resource-group variable binding plus its recorded passing
format-specific conformance. This happens before what-if so a stale resource-group binding or old PostgreSQL
readiness/admin pattern can never become the first live deployment attempt.

For every Node API, run the generated-runtime gate before packaging:

```text
node .github/agents/azure-deploy/deploy/scripts/validate-node-runtime-contracts.mjs --root {backendRoot} --require-correlation
```

Append `--require-postgres-mi` for production PostgreSQL and `--require-migration-probe` when the root
contains a migration controller. Run the component's focused tests and build after this static gate.
The static gate is not a replacement for tests; it prevents known-bad legacy assets from reaching Azure.

### 0. Auth Token Verification

```bash
az account show --subscription {subscriptionId}
```

- Success with the exact locked subscription + tenant → proceed.
- Failure → `ENVIRONMENT_BLOCKING`. Suggest `az login` (plain, no scope).
- ⛔ NEVER suggest `az login --scope https://graph.microsoft.com/.default` — Graph scope is irrelevant for ARM deployments.

### 0b. Resource Name Availability

Check globally-unique names before deploy with explicit subscription scope on every Azure CLI call:
`az acr check-name --subscription {subscriptionId} --name {name}`,
`az storage account check-name --subscription {subscriptionId} --name {name}`,
`az webapp show --subscription {subscriptionId} --resource-group {resourceGroup} --name {name}`, and
`az keyvault show --subscription {subscriptionId} --name {name}`. Name taken → suggest alternate from
`prepare-plan.json.naming.suffix`: "Name `{name}` taken. Use `{altName}`?"

### 0c. F1/Free Tier Warning

If plan includes F1/D1/free SKUs, surface at deploy gate (do NOT block):
> ⚠️ Free tier: no custom domains, no SSL, no always-on, 60 min/day compute (F1). Dev/test only.

### 0d. RBAC Scope Pre-Check

```bash
az role assignment list --subscription {subscriptionId} --assignee {userId} --scope /subscriptions/{sub} --query "[].roleDefinitionName" -o tsv
```

Subscription-scope deploy requires `Contributor`/`Owner` on subscription. Missing → `ENVIRONMENT_BLOCKING` with `az role assignment create` command.

### 1. Deployment Preview

⛔ **MANDATORY — do NOT skip.** What-if validates + previews in one call. Use `what-if` exclusively — `az deployment sub/group validate` hits a known CLI bug (HTTP stream consumed error). If what-if fails, log + warn user — do not skip to execution.

#### Bicep (subscription scope)

```bash
az deployment sub what-if \
  --name "{deploymentName}" \
  --location {location} \
  --template-file infra/main.bicep \
  --parameters @infra/main.parameters.json \
  --subscription {subscriptionId} \
  --what-if-result-format FullResourcePayloads
```

#### Bicep (resource-group scope)

```bash
az deployment group create \
  --resource-group {rg} \
  --template-file infra/main.bicep \
  --parameters @infra/main.parameters.json \
  --subscription {subscriptionId} \
  --what-if \
  --what-if-result-format FullResourcePayloads
```

- Review changes: `Create`, `Modify`, `Delete`, `NoChange`. Surface `Delete` as warnings — user must acknowledge.
- Auth error → `ENVIRONMENT_BLOCKING`.

#### Terraform

```bash
terraform plan -out=tfplan -detailed-exitcode
```

- Exit 0 → no changes. Exit 2 → changes (normal). Exit 1 → error.
- Surface `destroy` as warnings — user must acknowledge. Auth error → `ENVIRONMENT_BLOCKING`.

### 3. RBAC Permission Check

```bash
az role assignment list \
  --subscription {subscriptionId} \
  --assignee {currentUserObjectId} \
  --scope /subscriptions/{sub}/resourceGroups/{rg} \
  --query "[].roleDefinitionName" -o tsv
```

Required: `Contributor` or `Owner` on the target resource group. If missing → `ENVIRONMENT_BLOCKING` with remediation command.

### 4. SKU Quota Verification

⛔ **`what-if` does NOT catch quota errors.** It returns `Succeeded` even when target SKU has limit=0.

If `prepare-plan.json.quotaValidation.verified == true` → proceed.

Otherwise → **read [sku-quota-validation.md](../../prepare/references/sku-quota-validation.md)** and run direct quota checks NOW (per-provider API patterns, offer restrictions). If limit=0 → HALT, present region fallback. Skip regions in `quotaValidation.checkedRegions` with zero availability.

⛔ `SubscriptionIsOverQuotaForSku` or `LocationIsOfferRestricted` in deploy output → HALT. See [error-classification.md](error-classification.md).

### 5. Resource Group Existence

```bash
az group show --subscription {subscriptionId} --name {rg} --query "location" -o tsv 2>/dev/null
```

- Exists → verify location matches `prepare-plan.json` region. Mismatch → warn.
- Not exists → will be created by deployment (if `main.bicep` has subscription scope).

## Error Handling

Each check runs independently. Collect all results, then present structured report.

| Check | Fail Behavior |
|-------|---------------|
| Immutable artifact/runtime contract | Block before what-if. Return to the owning prepare/scaffold/integration phase; never patch during deploy. |
| Deployment preview | Warn, don't block (can fail on unsupported types) |
| RBAC | Block. Surface `az role assignment create`. |
| RG check | Warn on location mismatch. Don't block. |

## Report Format

```
## Preflight Results
✅ IaC syntax: valid (terraform validate / bicep build)
⚠️ Deployment preview: 3 creates, 0 destroys, 1 update
✅ RBAC: Contributor role confirmed
✅ Resource group: rg-myapp-dev (eastus2)
```
