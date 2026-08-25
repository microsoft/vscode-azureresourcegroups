# Deploy Approval — Handled by the Deployment Plan Webview

⛔ **The deploy phase does NOT present a chat approval gate.** Approval happens once, earlier, at the **Deploy Gate (orchestrator Step 6)**: the pipeline calls the `open_deploy_plan_view` tool and the user approves the plan in the Deployment Plan webview BEFORE any IaC is generated. See [`../../references/approval-gates.md`](../../references/approval-gates.md).

By the time the deploy phase runs (orchestrator Step 8), the plan is already approved. Do NOT:

- print a service table, cost table, resource list, subscription/RG/region block, or generated-files list in chat
- ask "🚀 Ready to deploy?" or any Yes / Run manually / Edit plan / Cancel prompt in chat
- re-request approval for a clean deployment

All of that content lives in the Deployment Plan view, sourced from the session artifacts (`prepare-plan.json` + `context.json` + `scaffold-manifest.json`).

## Re-approval (plan changes only)

If a region/SKU/service value changes from what the user approved (e.g., a quota-forced region fallback during scaffold or deploy), that is a plan change → **re-open the Deployment Plan view** for re-approval. Never fall back to a chat prompt. See [deploy-safety.md](deploy-safety.md) § Re-Approval Gates.

## "Run manually" path

Only if the user explicitly chooses to run the deployment themselves, surface the exact CLI commands based on `iacFormat`:

- **Bicep (subscription-scope, default):** `az deployment sub create --subscription {subscriptionId} --location {location} --template-file infra/main.bicep --parameters @infra/main.parameters.json --query properties.provisioningState -o tsv`
- **Bicep (resource-group scope, after 403 fallback):** `az deployment group create --resource-group {rg} --template-file infra/main.bicep --parameters @infra/main.parameters.json --query properties.provisioningState -o tsv`
- **Terraform (alternative):** `cd infra && terraform init && terraform plan -out=tfplan && terraform apply tfplan`

Then stop.
