# Preflight Checks

Pre-deploy validation. Run after approval, before execution.

> AppOnboard deploys directly (no `azd`).

## Check Sequence

Branch by `scaffold-manifest.json.iacFormat`:

### 0. Auth Token Verification

```bash
az account show
```

- Success → proceed; active subscription + tenant confirmed.
- Failure → `ENVIRONMENT_BLOCKING`. Suggest `az login` (plain, no scope).
- ⛔ NEVER suggest `az login --scope https://graph.microsoft.com/.default` — Graph scope is irrelevant to ARM.

### 0b. Resource Name Availability

Precheck globally unique names: `az acr check-name`, `az storage account check-name`, `az webapp show`, `az keyvault show`. If taken, suggest alternate from `prepare-plan.json.naming.suffix`: "Name `{name}` taken. Use `{altName}`?"

### 0c. F1/Free Tier Warning

For F1/D1/free SKUs, show at deploy gate without blocking:
> ⚠️ Free tier: no custom domains, no SSL, no always-on, 60 min/day compute (F1). Dev/test only.

### 0d. RBAC Scope Pre-Check

```bash
az role assignment list --assignee {userId} --scope /subscriptions/{sub} --query "[].roleDefinitionName" -o tsv
```

Subscription-scope deploy requires subscription `Contributor`/`Owner`. Missing → `ENVIRONMENT_BLOCKING` with `az role assignment create`.

### 1. Deployment Preview

⛔ **MANDATORY—never skip.** What-if validates + previews in one call. Use only `what-if`; `az deployment sub/group validate` has known HTTP stream consumed bug. On failure, log + warn user; do not execute.

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

- Review `Create`, `Modify`, `Delete`, `NoChange`. Warn on `Delete`; user must acknowledge.
- Auth error → `ENVIRONMENT_BLOCKING`.

#### Terraform

```bash
terraform plan -out=tfplan -detailed-exitcode
```

- Exit 0 → no changes. Exit 2 → normal changes. Exit 1 → error.
- Warn on `destroy`; user must acknowledge. Auth error → `ENVIRONMENT_BLOCKING`.

### 3. RBAC Permission Check

```bash
az role assignment list \
  --assignee {currentUserObjectId} \
  --scope /subscriptions/{sub}/resourceGroups/{rg} \
  --query "[].roleDefinitionName" -o tsv
```

Requires target RG `Contributor` or `Owner`. Missing → `ENVIRONMENT_BLOCKING` with remediation command.

### 4. SKU Quota Verification

⛔ **`what-if` misses quota errors**, returning `Succeeded` even when target SKU limit=0.

If `prepare-plan.json.quotaValidation.verified == true` → proceed.

Otherwise → **read [sku-quota-validation.md](../../prepare/references/sku-quota-validation.md)**; run direct quota checks NOW (provider API patterns, offer restrictions). limit=0 → HALT, present region fallback. Skip zero-availability regions in `quotaValidation.checkedRegions`.

⛔ `SubscriptionIsOverQuotaForSku` or `LocationIsOfferRestricted` in deploy output → HALT. See [error-classification.md](error-classification.md).

### 5. Resource Group Existence

```bash
az group show --name {rg} --query "location" -o tsv 2>/dev/null
```

- Exists → verify location matches `prepare-plan.json` region; warn on mismatch.
- Not exists → will be created by deployment (if `main.bicep` has subscription scope).

## Error Handling

Run checks independently. Collect results; present structured report.

| Check | Fail Behavior |
|-------|---------------|
| Deployment preview | Warn, don't block (unsupported types may fail) |
| RBAC | Block. Surface `az role assignment create`. |
| RG check | Warn on location mismatch; don't block. |

## Report Format

```
## Preflight Results
✅ IaC syntax: valid (terraform validate / bicep build)
⚠️ Deployment preview: 3 creates, 0 destroys, 1 update
✅ RBAC: Contributor role confirmed
✅ Resource group: rg-myapp-dev (eastus2)
```
