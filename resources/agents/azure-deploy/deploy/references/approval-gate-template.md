# Approval Gate Template

Deploy approval gate template. Present after preflight validation, before execution.

## Display Format

```
## Deploy Approval

🏢 **Subscription:** {context.json.azure.subscriptionName} (`{context.json.azure.subscriptionId}`)
📁 **Resource Group:** {context.json.azure.resourceGroup}
🌍 **Region:** {context.json.azure.region}

**Services:**
| Service | SKU | Region | Resource Name |
|---------|-----|--------|---------------|
{for each service in prepare-plan.json.services[]}

**💰 Estimated Monthly Cost:** ${costEstimate.monthlyUsd}/month
| Service | SKU | Monthly |
|---------|-----|---------|
{for each item in costEstimate.breakdown[]}
{costEstimate.disclaimer}

**🔒 Validation:** {scaffold-manifest.json.validationResult.status}
{if FLAGGED findings from scaffold self-review → ⚠️ list each}

**📋 What-if preview:** {N} resources to create, {N} to modify, {N} unchanged
{if any Delete operations → ⚠️ list each deleted resource with name + type}

**Generated Files:**
{for each file in scaffold-manifest.json.files[]}

**📦 Deployment Summary:**
{Display the "What's Being Deployed" table here, built from prepare-plan.json.services[] — showing which components map to which Azure services, SKUs, and estimated costs. (deployment-summary.md is not written until the deploy/handoff phase)}

---
**🚀 Ready to deploy? (Yes / Run manually / Edit plan / Cancel)**
```

## Response Handlers

| Response | Action |
|----------|--------|
| **Yes** | Execute deployment (Step 6 of deploy workflow). Do NOT re-confirm. |
| **Run manually** | Show exact CLI commands based on `iacFormat`:<br>**Bicep (subscription-scope, default):** `az deployment sub create --subscription {subscriptionId} --location {location} --template-file infra/main.bicep --parameters @infra/main.parameters.json --query properties.provisioningState -o tsv`<br>**Bicep (resource-group scope, after 403 fallback):** `az deployment group create --resource-group {rg} --template-file infra/main.bicep --parameters @infra/main.parameters.json --query properties.provisioningState -o tsv`<br>**Terraform (alternative):** `cd infra && terraform init && terraform plan -out=tfplan && terraform apply tfplan`. Stop. |
| **Edit plan** | Ask what to change → write to `context.json.overrides[]` → re-run prepare (Step 4) → re-scaffold → return to approval gate |
| **Cancel** | Preserve all session artifacts. Say "💾 Session preserved — resume anytime." Stop. |

## Rules

- ⛔ Gate is response's LAST content — stop until user replies
- ⛔ SKU column MUST show exact Azure SKU code + tier name (e.g., "B1 Linux (Basic)", "P1v3 (Premium)"), not generic labels like "cheapest tier". Never select F1/D1/Free.
- Always show monthly cost estimate — no $0 tier (B1 floor ~$13/mo)
- Surface ALL `FLAGGED` self-review findings so user sees risks before approval
- Validation failure: show failures; block Yes until resolved
