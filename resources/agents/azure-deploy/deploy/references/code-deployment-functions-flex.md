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

Build and validate the immutable package, then deploy with the Functions channel. **TypeScript uses a
precompiled, self-contained package by default.** A structurally valid source ZIP is insufficient: Oryx can
select a different Node major than `functionAppConfig.runtime`, omit monorepo sibling sources, or finish with
zero registered Functions.

```powershell
# Python — zip the project root and request a Linux remote build when native wheels require it.
az functionapp deployment source config-zip `
  --subscription {sub} -g {rg} -n {app} `
  --src $zipPath --build-remote true

# TypeScript / Node — deploy the validated precompiled package; never ask Oryx to choose the Node toolchain.
az functionapp deployment source config-zip `
  --subscription {sub} -g {rg} -n {app} `
  --src $zipPath --build-remote false

# .NET (isolated) / Java / Go — deploy precompiled output at the ZIP root.
az functionapp deployment source config-zip --subscription {sub} -g {rg} -n {app} --src $zipPath --build-remote false
```

Do not use `func azure functionapp publish` for the TypeScript path because it can re-enable a remote build.

### TypeScript/Node package gate

1. Require the IaC runtime and `package.json.engines.node` to support the same major (Node 22 for the current
   template). Run the build from a clean checkout/staging directory, not from a previously built monorepo:
   install with the lockfile, run the clean script, compile, and prune to production dependencies.
2. Stage a package root containing `host.json`, `package.json`, the lockfile, compiled `dist/`, production
   `node_modules/`, migrations, and any runtime assets. The package must contain the complete compiled closure
   for sibling/shared source imports; no compiled relative import may resolve outside the package.
3. Determine the exact expected Function names from the scaffolded handlers and deployment manifest. Before
   upload, validate both the staging directory and the final ZIP:

   ```text
   node .github/agents/azure-deploy/deploy/scripts/validate-functions-flex-package.mjs --root {stagingRoot} --node-major 22 --expected-functions health,createItem,listItems
   node .github/agents/azure-deploy/deploy/scripts/validate-functions-flex-package.mjs --zip {zipPath} --node-major 22 --expected-functions health,createItem,listItems
   ```

   The validator rejects missing root manifests/lockfile, Node-major mismatch, backslash/traversal ZIP entries,
   a `package.json.main` glob that does not resolve to the exact expected Function set, missing production
   dependencies, and broken/escaping compiled relative imports. Preserve its ZIP byte count and SHA-256 in
   deployment evidence.
4. Upload once with `--build-remote false`. A failed validator is a pre-upload package defect, not a deployment
   attempt. A failed upload requires diagnosis and a changed, revalidated package; never send an unchanged ZIP.
5. Immediately after a successful upload, require the registered Functions to equal the expected set:

   ```powershell
   az functionapp function list --subscription {sub} -g {rg} -n {app} --query "[].name" -o tsv
   ```

   Normalize returned `app/functionName` values to the final segment and compare exact sets. Then require
   `/api/health` to be non-404 and dependency-aware. Upload success without exact registration and health is
   not an application-healthy release.

If a Node dependency has a native binary, build/prune in a controlled Linux environment pinned to the same
Node major. Do not hand toolchain selection back to an unpinned remote builder.

- The runtime is fixed by `functionAppConfig.runtime` in IaC — do **not** pass or set `FUNCTIONS_WORKER_RUNTIME`.
- The deploying identity writes the package to the deployment container. With shared-key access disabled, that
  identity (the signed-in user for a local deploy, or the CI principal) needs **Storage Blob Data Contributor**
  on the deployment storage account, in addition to the function app's own identity role.
- After deploy, sync is automatic; then run the exact registration and health gates above.

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

HTTP GET the function endpoint(s) (max 3 iterations, honoring cold start) only after exact Function
registration passes. A Flex app can take up to ~30s to initialize on first start;
`System.TimeoutException`/gRPC host messages during that window are startup noise, not deploy failures.
Inspect the response body for error patterns (`connection refused`, `MODULE_NOT_FOUND`,
`SET-IN-DEPLOY-PHASE`) — HTTP 200 alone is not proof of health when the app depends on another service.

## Database post-deploy

> ⛔ If the app uses a managed database, run [`database-post-deploy.md`](database-post-deploy.md) for migration
> discovery and execution.
