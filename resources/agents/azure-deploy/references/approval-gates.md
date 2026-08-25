# Deploy Gate — Step 6 (webview approval)

> **Gate summary:** AppOnboard has **one approval gate**: the **Deploy Gate** (orchestrator Step 6). It is presented by **opening the Deployment Plan webview** — call the `open_deploy_plan_view` tool, then STOP. There is **no chat approval prompt and no chat tables**. The plan (subscription, resource group, region, services + SKUs, resource names, monthly cost) is rendered in the view, which owns the approve / edit / cancel decision. ⛔ **There is no scaffold gate** — IaC is NOT generated until the user approves the plan in the view; Step 7 (scaffold) runs only on approval.

## Deploy Gate (Step 6) — open the webview

Once `prepare-plan.json` is written (Step 5), present the plan for approval by opening the webview:

> ⛔ **Call the `open_deploy_plan_view` tool, then STOP.** This is the ONLY correct action at the Deploy Gate. Do NOT print the plan, a service table, a cost table, a resource list, a subscription/RG block, or a `🚀 Ready to deploy?` prompt in chat — all of that lives in the view. The plan data is sourced from the session artifacts under `.copilot-azure/sessions/{id}/` (`prepare-plan.json` + `context.json`); record everything the user needs to decide there, never in chat.

> ⛔ **RESPONSE BOUNDARY — MANDATORY.** Opening the view is the LAST action in your response. Do NOT generate any files, write any IaC, create any Dockerfiles, or execute any commands in the same response. The webview drives approval and re-invokes the pipeline; wait for it. If the view has not reported approval, WAIT — do not proceed.

### Plan details the view renders (record in artifacts — never print in chat)

These were previously surfaced at the chat gate. They are now plan data the view renders. Ensure each is recorded in the session artifacts so the view can show it; do NOT duplicate them in chat:

- **IaC format** — `context.json.overrides[].iacFormat`: Terraform (`infra/*.tf`) or Bicep (default, `infra/main.bicep`). Exclude `azure.yaml` from the file list (see pipeline-rules.md).
- **Plan assumptions** — `prepare-plan.json.assumptions[]` (e.g., free-tier degradation to a paid SKU, AI inference costs excluded).
- **Data-loss warnings** — `prereq-output.json.warnings[]` (SQLite on App Service, in-memory sessions, local file storage).
- **Database network access** — when the plan includes PostgreSQL/MySQL: the default `AllowAllAzureServicesAndResourcesWithinAzureIps` (`0.0.0.0`) rule opens the server to all Azure services, plus the private-networking alternative.
- **Azure service compatibility warnings** — `prereq-output.json.warnings[]` with `fixPhase: "deploy-gate"`.
- **Container Apps deploy preview** — when the plan includes Container Apps: build via ACR, replace placeholder images, redeploy; if `buildRequirements.hasBuildKitSyntax == true`, note ACR-compatible versions will be created.

### After the view reports its decision

- **Approved** → proceed to Step 7 (Scaffold — generate IaC), then Step 8 (Deploy). Do NOT re-confirm in chat. Read `deploy/instructions.md` before any deployment action.
- **Edit plan** → the view supplies the change → write it to `context.json.overrides[]` → re-run Step 5 (prepare) → re-open the view.
- **Cancel** → preserve session artifacts for later resumption, stop.
- **Private access** (plan includes PostgreSQL/MySQL) → set `context.json.routeToSkill: "azure-enterprise-infra-planner"` and `routeReason: "private-networking-requested"`, then **HALT** — do NOT generate IaC. Hand off to the `azure-enterprise-infra-planner` agent (it owns the secure networking design **and** its deployment). The AppOnboard session is preserved for reference.

> ⛔ **Re-approval routes through the view too.** If a downstream region/SKU/service change requires re-approval (see [deploy-safety.md](../deploy/references/deploy-safety.md) § Re-Approval Gates), re-open the Deployment Plan webview — never fall back to a chat prompt or chat tables.
