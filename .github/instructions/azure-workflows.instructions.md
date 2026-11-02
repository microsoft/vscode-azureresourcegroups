---
description: 'Use account-aware Azure clients, safe resource actions, activity reporting, and platform-aware Cloud Shell flows.'
applyTo: "src/commands/accounts/**, src/commands/createResource*.ts, src/commands/deleteResourceGroup/**, src/commands/sovereignCloud/**, src/commands/tags/**, src/commands/openInPortal.ts, src/commands/viewProperties.ts, src/services/**, src/utils/azureClients.ts, src/utils/activityUtils.ts, src/cloudConsole/**, src/managedIdentity/**, src/exportAuthRecord.ts, test/nightly/**, test/cloudConsole.test.ts, test/ipc.test.ts, test/getTagDiagnostics.test.ts"
---

# Azure operations, authentication, and Cloud Shell

## Authentication ownership and token flow

- Azure Resources is the shared authentication/subscription integration consumed by other Azure
  extensions. Activation assigns `ext.subscriptionProviderFactory` in `src/extension.ts`;
  `src/services/getSubscriptionProviderFactory.ts` normally selects the cached Resources subclass
  in `src/services/VSCodeAzureSubscriptionProvider.ts`. That subclass extends the
  `@microsoft/vscode-azext-azureauth` provider and adds Accounts & Tenants selection filtering.
- The auth package, not this extension, implements the normal session acquisition:
  `AzureSubscriptionProviderBase` -> `getSessionFromVSCode` -> `vscode.authentication.getSession`.
  Its `getConfiguredAuthProviderId` selects VS Code's built-in Microsoft Authentication provider:
  `microsoft` for public Azure, `microsoft-sovereign-cloud` otherwise. Cloud configuration comes
  from `microsoft-sovereign-cloud.environment` / `customEnvironment`; do not hard-code authority,
  ARM endpoints, or token audiences.
- Accounts come from `vscode.authentication.getAccounts`; tenants and subscriptions are discovered
  through the Azure subscription SDK using session-backed credentials. An account is not a tenant
  or subscription, and a signed-in account does not guarantee every tenant is authenticated or
  that any subscription is selected. Preserve account identity, tenant scope, filtering, and cache
  invalidation across sign-in, session changes, cloud changes, and tree refresh.
- Returned subscriptions expose `authentication.getSession()` and `getSessionWithScopes(...)`.
  The package normalizes resource scopes to `.default`, uses the configured environment's
  `managementEndpointUrl` for default scopes, and adds `VSCODE_TENANT:<tenantId>`. Plain scope
  requests are silent by default; `createIfNone: true` allows interactive consent, and
  WWW-Authenticate challenges allow prompting. Preserve these distinctions, cancellation, and
  missing-session errors; do not turn background enumeration into unsolicited sign-in.
- `createSubscriptionContext` / `createCredential` from `@microsoft/vscode-azext-utils` adapt
  subscription session access into SDK credentials (`getToken` returns the session access token).
  They do not establish another login. Keep using the selected subscription and existing client
  factories; `AzureResourcesService.ts` has tenant/account-specific session handling for duplicate
  subscriptions. Never log sessions, tokens, or credential payloads.
- Azure CLI / azd login is a separate process credential context, not proof of VS Code sign-in
  (or vice versa). The explicit alternative here is
  `src/services/AzureDevOpsSubscriptionProvider.ts`, selected by the factory's federated-credential
  environment flags for pipeline scenarios. Test provider overrides and mocks are additional
  test seams, not the normal Microsoft Authentication flow or a production credential fallback.
- Diagnose session acquisition, tenant/subscription discovery, filtering, and SDK token use at
  their owning boundaries. Inspect the installed auth package's `providers` and `utils` modules
  before changing assumptions about scopes or prompting; its implementation lives in
  `microsoft/vscode-azuretools`, not in a consuming extension.

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
