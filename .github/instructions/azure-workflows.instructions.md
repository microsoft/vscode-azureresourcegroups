---
description: 'Implement generic Azure resource, account, tag, grouping, and managed identity workflows safely.'
applyTo: "src/commands/accounts/**,src/commands/activities/**,src/commands/createResource.ts,src/commands/createResourceGroup.ts,src/commands/deleteResourceGroup/**,src/commands/explorer/**,src/commands/focus/**,src/commands/openInPortal.ts,src/commands/revealResource.ts,src/commands/sovereignCloud/**,src/commands/tags/**,src/commands/viewProperties.ts,src/managedIdentity/**,src/services/**,src/utils/activityUtils.ts,src/utils/azureClients.ts,src/utils/azureUtils.ts,test/nightly/**"
---

# Generic Azure workflow instructions

## Accounts, tenants, and sovereign clouds

- Use `ext.subscriptionProviderFactory()` for account, tenant, and subscription access. Do not retain or
  copy credentials outside the provider/session abstractions.
- Account or tenant changes may affect Resources, Focused Resources, and Accounts & Tenants. Clear and
  refresh each affected view's cache deliberately.
- `src/commands/sovereignCloud/**` owns environment selection. Preserve custom-cloud endpoints and the
  hybrid Resource Management client path in `src/utils/azureClients.ts`.
- Telemetry may record bounded sign-in outcomes or cloud categories, never account labels, tenant IDs,
  subscription IDs, or tokens.

## Create and delete resource groups

- `createResourceGroup.ts` composes shared Azure Tools resource-group/location steps, activity context,
  and a targeted subscription refresh.
- `deleteResourceGroup/v2/deleteResourceGroupV2.ts` owns tree multi-select and command-palette picking,
  resource counting, the configured confirmation mode, and per-resource-group activity state.
- `DeleteResourceGroupStep.ts` owns the ARM deletion and must await the long-running operation.
- Keep destructive confirmation proportional and explicit. Never weaken name confirmation or the modal
  delete action without an intentional product decision.
- Handle paging when listing resource groups/resources, preserve cancellation, and refresh only after the
  mutation completes or has intentionally started in background activity.

## Contributions, grouping, focus, and navigation

- `createResource.ts` executes create commands contributed through `x-azResources`. Activate the owning
  extension before invoking its command so VS Code does not serialize tree arguments.
- Grouping changes belong in `src/commands/explorer/**` and `src/tree/azure/grouping/**`; keep settings,
  context values, labels/icons, and Focused Resources behavior coordinated.
- Validate programmatic resource-group IDs before setting focus. Keep API-triggered errors rejectable and
  suppress duplicate UI only when the API caller owns it.
- Portal URLs, properties, and reveal behavior must use existing Azure ID/URL helpers and must not expose
  secrets in telemetry or errors.

## Tags, activities, and managed identity

- `TagFileSystem` is a virtual JSONC edit/save workflow. Preserve diagnostics, vscode.dev-safe buffer
  handling, confirmation before replacement, and the distinction between resource and resource-group
  tag lookup.
- Validate parsed tag documents before sending an update. Do not log or emit tag keys/values.
- Register Azure mutations with Activity Log through `createActivityContext`; keep titles useful while
  excluding secrets and arbitrary payloads.
- Reuse shared Azure Tools managed-identity and role-assignment helpers. Cross-subscription role loading
  is optional expansion behavior; isolate per-subscription failures and refresh the owning node.

Use `createResourceClient` and shared Azure Tools helpers for all resource operations. Preserve paging,
custom clouds, cancellation, activity output, and targeted refresh, and add live-Azure coverage only
under existing nightly gates.
