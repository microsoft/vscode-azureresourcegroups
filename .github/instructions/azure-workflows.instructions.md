---
description: 'Use account-aware Azure clients, safe resource actions, activity reporting, and platform-aware Cloud Shell flows.'
applyTo: "src/commands/accounts/**, src/commands/createResource*.ts, src/commands/deleteResourceGroup/**, src/commands/sovereignCloud/**, src/commands/tags/**, src/commands/openInPortal.ts, src/commands/viewProperties.ts, src/services/**, src/utils/azureClients.ts, src/utils/activityUtils.ts, src/cloudConsole/**, src/managedIdentity/**, src/exportAuthRecord.ts, test/nightly/**, test/cloudConsole.test.ts, test/ipc.test.ts, test/getTagDiagnostics.test.ts"
---

# Azure operations, authentication, and Cloud Shell

## Account and cloud context

- Obtain subscriptions through `ext.subscriptionProviderFactory`, configured by
  `src/services/getSubscriptionProviderFactory.ts`. It chooses VS Code authentication or the Azure
  DevOps federated-credential provider; do not replace it with a new default credential chain.
- Preserve account, tenant, selected-subscription, and unselected-tenant filtering. The VS Code
  provider applies the Accounts & Tenants view selection in addition to subscription settings;
  `filter: false` is meaningful and must not silently become the filtered path.
- Use `createSubscriptionContext` and the selected node/subscription when creating clients. Reuse
  `createResourceClient` in `src/utils/azureClients.ts`: it lazy-loads the normal or custom-cloud
  ARM client. Do not hard-code public-cloud management, authority, portal, or Cloud Shell endpoints.
- Preserve the sign-in and selection refresh/cache-invalidating behavior in `registerCommands.ts`
  across Azure, Focus, and Tenants views. A successful sign-in with stale trees is incomplete.

## Mutating resources

- Follow `createResourceGroup.ts` and `deleteResourceGroup/v2/deleteResourceGroupV2.ts`: accept a
  valid selected node, otherwise use the existing subscription/resource selection experience.
  Validate command inputs because commands can run without their menu's context restrictions.
- Reuse `AzureWizard` prompt/execute steps and `createActivityContext` for matching long-running
  operations. Keep cancellation, activity status, temporary node descriptions, output, and final
  refresh consistent; do not report success before the Azure operation completes.
- Resource-group deletion removes contained resources. Preserve resource counts, the configured
  click-button or type-name confirmation, post-input validation, and multi-selection semantics.
  Resolve the right subscription before performing destructive work.
- Tags are edited through `TagFileSystem` and JSONC diagnostics. Preserve validation before upload,
  explicit confirmation, placeholder-tag removal, and the deliberate `Replace` operation at the
  correct resource scope; a partial tag update is not equivalent to replacing all tags.
- Managed-identity/role changes must retain the intended principal, target scope, and subscription.
  Do not broaden permissions or enumerate all subscriptions as a shortcut around selection.

## Cloud Shell and processes

- Trace terminal profiles in `src/extension.ts` through `src/cloudConsole` and the
  `cloudShellChildProcess` launcher. Changes to the launcher must remain compatible with its
  separate entry point in `esbuild.mjs`.
- Preserve Bash versus PowerShell behavior, cancellation, terminal/child-process cleanup, and
  upload error reporting. Never log access tokens or put credentials in command strings.
- Keep IPC platform-specific handling in `src/cloudConsole/ipc.ts`: Windows named pipes are not
  Unix sockets, and Unix socket limits count bytes. Preserve nonce-based handles and the existing
  long-path fallback; extend `test/ipc.test.ts` for path-limit or platform changes.
- Use the existing cloud-console, tag-diagnostic, and mock-service tests before opting into live
  Azure tests. Live tests under `test/nightly` must remain explicitly gated and clean up resources
  they create.
