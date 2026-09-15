# Code Deployment — Azure Functions (Flex Consumption)

How to deploy application code to a **Flex Consumption** function app after its IaC is provisioned. This is a
**different channel** from App Service — read this instead of
[code-deployment-appservice.md](code-deployment-appservice.md) whenever the compute is Functions on Flex
Consumption (the default Functions floor). Only **Functions on Premium (EP1)** use the App Service SCM/Kudu
path.

> ⛔ **`--subscription {subscriptionId}` on EVERY `az` command.**

## The Flex deploy model (why the App Service path does not apply)

Flex Consumption has a **single deployment path**: you build and zip your project, the package is written to a
**blob storage container**, and the app runs from that package on startup. There is **no** Kudu
`SCM_DO_BUILD_DURING_DEPLOYMENT`/Oryx-on-SCM build, **no** `az webapp deploy --type zip`, and **no**
`basicPublishingCredentialsPolicies` (`scm`/`ftp`) enable/re-disable dance. Do not run any of those against a
Flex app — they either error or silently do nothing.

## Deploy the package

Build/zip the project, then deploy with the Functions channel. Prefer a **remote build** for interpreted
runtimes so native wheels/modules are built on Linux, not on the local machine:

```powershell
# Python / Node / TypeScript — zip the PROJECT ROOT (manifest at the zip root) and request a remote build.
az functionapp deployment source config-zip `
  --subscription {sub} -g {rg} -n {app} `
  --src $zipPath --build-remote true

# .NET (isolated) / Java / Go — deploy a precompiled package (build output at the zip root); no remote build.
az functionapp deployment source config-zip --subscription {sub} -g {rg} -n {app} --src $zipPath
```

`func azure functionapp publish {app}` (Azure Functions Core Tools) is an equivalent channel and also performs
a remote build — use it if Core Tools is already the project's workflow.

- The runtime is fixed by `functionAppConfig.runtime` in IaC — do **not** pass or set `FUNCTIONS_WORKER_RUNTIME`.
- The deploying identity writes the package to the deployment container. With shared-key access disabled, that
  identity (the signed-in user for a local deploy, or the CI principal) needs **Storage Blob Data Contributor**
  on the deployment storage account, in addition to the function app's own identity role.
- After deploy, sync is automatic; then run the health check below.

## ⛔ Local (non-CI) deploys: hardening can lock you out — do not deny-by-default before first deploy

This pipeline hardens network access, which is CI/CD-friendly but **can block a deploy run from a developer
machine.** Two Flex-specific facts matter:

1. **Flex outbound is a platform-managed gateway pool, not a per-instance IP.** An SCM/site allow rule built
   from the deployer's observed public IP (e.g. via ipify) will **not** match the channel's real egress, so it
   does not unblock the deploy and often changes between attempts. Do **not** try to punch a `/32` SCM hole to
   fix a 403 — it is the wrong lever for Flex.
2. **Model the main site and the deployment/SCM surface independently.** Restricting one must not implicitly
   deny the other.

**Rules for the deploy phase:**

- ⛔ **Do NOT set `publicNetworkAccess: 'Disabled'` or a deny-by-default rule on the function app or its
  deployment storage BEFORE the first successful code deploy + health check.** Provision with access open,
  deploy, verify, *then* harden.
- Before hardening, **tell the user** (once, plainly): *"This deployment hardens network access for
  production. Publishing the code from your machine happens first, while access is still open; after the app
  is healthy I'll restrict it. If you need to redeploy later from your machine, you may need to temporarily
  re-open access or deploy from CI."*
- If a package deploy returns **HTTP 403**, the cause is network hardening applied too early or a missing
  Storage Blob Data role — **not** a missing SCM allow rule. Re-open public access on the app + deployment
  storage, confirm the deployer's role assignment, redeploy, then re-harden. Never fall back to imperative
  provisioning.
- ⛔ **Azure inserts a terminal "Deny all" rule as the last entry of any `ipSecurityRestrictions` /
  `scmIpSecurityRestrictions` list — this is the expected default sentinel, NOT an error.** Validation must
  treat a trailing deny-all with priority `2147483647` (name `Deny all`/`Explicit deny`) as normal. Only flag
  it if there are **no** preceding allow rules AND you intended the surface to be reachable.

## Hardening (only AFTER a healthy deploy)

If the plan calls for a locked-down app, apply `publicNetworkAccess`/IP restrictions as the **last** step,
after the health check passes. Keep the deployment storage reachable by the app identity. Record any access
you re-open for a local deploy so cleanup is idempotent (re-running the step must not error if the rule is
already gone).

## Health check

HTTP GET the function endpoint(s) (max 3 iterations, honoring cold start). A Flex app can take up to ~30s to
initialize on first start; `System.TimeoutException`/gRPC host messages during that window are startup noise,
not deploy failures. Inspect the response body for error patterns (`connection refused`, `MODULE_NOT_FOUND`,
`SET-IN-DEPLOY-PHASE`) — HTTP 200 alone is not proof of health when the app depends on another service.

## Database post-deploy

> ⛔ If the app uses a managed database, run [`database-post-deploy.md`](database-post-deploy.md) for migration
> discovery and execution.
