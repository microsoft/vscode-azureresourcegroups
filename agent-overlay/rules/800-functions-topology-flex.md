# 800 — Functions topology and Flex Consumption

Two related problems. Upstream flattens a SPA + Functions repo into a single hosted app, which
destroys the topology our scaffold agent deliberately produced. And R-405 made Flex Consumption the
Functions floor without upstream having any Flex patterns — Flex is not an App Service and breaks
on App Service settings.

> **Promotion candidates.** R-801/R-802 author whole files. If upstream ships equivalent Flex
> guidance, delete these rules rather than carrying a second copy.

---

### R-801 — Flex Consumption Bicep

| | |
|---|---|
| Applies to | `scaffold/references/bicep-functions-flex.md` (overlay-authored) |
| Operation | author the Flex module; add a redirect banner to `bicep-app-service.md`; register it in `bicep-patterns.md` |
| Idempotency key | File exists |
| Check | `C-801` |

Flex uses `functionAppConfig` (deployment storage, `scaleAndConcurrency`, `runtime`) on an
`FC1`/`FlexConsumption` plan, Linux reserved.

⛔ Never emit on Flex: `FUNCTIONS_WORKER_RUNTIME` (conflicts with `functionAppConfig.runtime`),
`FUNCTIONS_EXTENSION_VERSION`, `SCM_DO_BUILD_DURING_DEPLOYMENT`, `ENABLE_ORYX_BUILD`,
`WEBSITE_RUN_FROM_PACKAGE`, `WEBSITE_CONTENTAZUREFILECONNECTIONSTRING`, `WEBSITE_CONTENTSHARE`,
`WEBSITES_CONTAINER_START_TIME_LIMIT`, `WEBSITE_TIME_ZONE`, `TZ`. These are the single most common
cause of a "provisioned but broken" Flex app.

Required companions: the deployment blob container as a real resource, and a Storage Blob Data role
for the app identity (shared-key is disabled by R-402, so without it the app cannot read its own
package and never starts).

Region-gate the plan — Flex is not available everywhere. Surface a region fallback at the quota
gate rather than silently relocating.

---

### R-802 — Flex deploy channel

| | |
|---|---|
| Applies to | `deploy/references/code-deployment-functions-flex.md` (overlay-authored), `code-deployment-appservice.md`, `blocked-patterns.md`, `deploy-checklist-template.md` |
| Operation | author the Flex deploy reference; retitle the App Service reference to cover App Service **and Premium/EP1 only** |
| Idempotency key | File exists |
| Check | `C-802` |

Flex deploys a package to a blob container: `az functionapp deployment source config-zip`
(`--build-remote true` for Python/Node) or `func azure functionapp publish`.

⛔ `blocked-patterns.md` blocks `az webapp deployment source config-zip`. Narrow that block to the
**`webapp`** command — the `functionapp` form is the *sanctioned* Flex channel, and an unqualified
block strands Flex deploys with no legal path.

Local-deploy warning the agent must actually say: hardening network access can block publishing
from a developer machine. Deploy with access open, verify health, then harden. An ipify-derived
`/32` SCM allow rule will **not** match Flex egress (platform gateway pool) — it is the wrong
lever, so do not try it. A trailing `Deny all` at priority `2147483647` is the expected platform
sentinel, not an error.

---

### R-803 — Flex has no SCM basic-auth toggle

| | |
|---|---|
| Applies to | `deploy/instructions.md` step 7, `scaffold/references/bicep-patterns-security.md`, `self-review-checklist.md`, `subagent-validate.md` |
| Operation | scope `basicPublishingCredentialsPolicies` to App Service and Premium/EP1 Functions; on Flex, flag their **presence** |
| Idempotency key | Flex exception clause in `bicep-patterns-security.md` |
| Check | `C-803` |

Upstream's step 7 re-disables SCM auth on "EVERY App Service/Functions app". On Flex that resource
does not exist, so the call targets nothing and the health-check step errors out on a healthy app.

---

### R-804 — Preserve Azure Functions components

| | |
|---|---|
| Applies to | `prereq/instructions.md`, `prereq/references/component-mapping.md`, `prepare/references/service-mapping.md`, `validation-rubric.md`, `references/intent-gathering.md` |
| Operation | classify a directory with `host.json` **plus** a Functions SDK/worker signal as an Azure Functions component |
| Idempotency key | `host.json` clause in `prereq/instructions.md` |
| Check | `C-804` |

Signals: `@azure/functions`, `Microsoft.NET.Sdk.Functions`, Functions Python decorators, or a
`FUNCTIONS_WORKER_RUNTIME` setting.

⛔ Do **not** classify HTTP-triggered Functions as a generic REST API — that is the reclassification
that causes the merge. Record the exact path in both `context.json.components[]` and
`prereq-output.json.components[]`. When a SPA and a Functions root both exist, record **two**
components even if the frontend calls the backend through `/api`.

---

### R-805 — Do not absorb a Function App into Static Web Apps

| | |
|---|---|
| Applies to | `azure-deploy.agent.md` addendum, `prepare/references/service-mapping.md`, `validation-rubric.md` |
| Operation | default to a detached SWA + Function App with explicit CORS |
| Idempotency key | "Preserve the scaffolded service topology" heading |
| Check | `C-805` |

Static Web Apps may host the frontend, but must not absorb, copy, move, or rebuild the Functions
source as an SWA-managed API. Do not set the backend's runtime, auth provider, or app settings to
`azureStaticWebApps` merely because the frontend uses SWA.

Linking an existing Function App as an SWA backend requires explicit user approval, and it remains
a separately provisioned and deployed Function App.

Gate condition: before the scaffold approval gate, verify every detected deployable component has a
planned compute service and every Functions component maps to Azure Functions. A plan that omits,
merges, or remaps one is invalid — fix it before showing it.
