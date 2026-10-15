---
description: 'Maintain the extensible Azure, Workspace, Focused Resources, Tenants, and Activity Log trees.'
applyTo: "package.json,package.nls.json,src/commands/registerCommands.ts,src/tree/**,src/api/ResourceGroupsExtensionManager.ts,src/api/ResourceProviderManagers.ts,src/utils/getResourceContributions.ts,src/utils/getResourceTypeOverrides.ts,src/utils/usedAndSelectedResources.ts,test/api/azureResourceBranchDataProvider.test.ts,test/api/branchDataProvider.test.ts,test/api/workspaceResourceProvider.test.ts,test/ResourceGroupGroupingItem.test.ts,test/focusGroup.test.ts,test/grouping.test.ts"
---

# Resource explorer instructions

## Contributions and registration

- `package.json`: view IDs, commands, menus, `when` clauses, welcome content, settings, and
  `x-azResources`.
- `package.nls.json`: localized contribution text.
- `src/commands/registerCommands.ts`: command dispatch and v1 wrapper unwrapping.
- `src/api/ResourceGroupsExtensionManager.ts`: lazy activation of installed extensions based on
  `x-azResources` branch/resource declarations.
- `src/api/ResourceProviderManagers.ts`: resource provider registration, activation, change events, and
  aggregation.

Do not eagerly activate contributing extensions. A new contribution field requires coordinated changes
to the published API type/docs, `getResourceContributions.ts`, consumers, and compatibility tests.

## Tree data flow

The normal flow is:

`ResourceProvider -> ResourceProviderManager -> BranchDataProvider -> BranchDataItemWrapper/cache ->
ResourceTreeDataProvider -> VS Code tree view`.

- `src/tree/ResourceTreeDataProviderBase.ts`: common refresh translation, wrapper/state handling, parent
  lookup, and ID traversal.
- `src/tree/ResourceBranchDataProviderManagerBase.ts`: branch provider ownership, event forwarding, and
  fallback provider behavior.
- `src/tree/BranchDataItemWrapper.ts`, `BranchDataItemCache.ts`: bridge client models into the host tree
  and preserve wrapper identity.
- `src/tree/TreeItemState.ts`: temporary descriptions, cached child state, and targeted refresh.
- `src/tree/azure/**`: subscriptions, Azure resources, grouping, and Focused Resources.
- `src/tree/workspace/**`: workspace resource discovery and branches.
- `src/tree/tenants/**`: accounts, tenants, sign-in state, and tenant refresh.
- `src/tree/activityLog/**`: activity models, state updates, and debounced targeted refresh.

## Invariants

- Keep IDs stable, unique, and traversable. Preserve account/tenant prefixes and case-insensitive Azure
  resource ID matching.
- Context-value changes can silently hide commands. Search every `package.json` `when` clause, context
  regex, picker, and compatibility adapter before changing one.
- Preserve all grouping modes: resource group, resource type, location, and ARM tag. Resource type
  overrides must resolve labels/icons from the contributing extension without trusting arbitrary paths.
- Preserve lazy branch activation, fallback items, load-more, invalid-item rendering, recently
  used/selected resources, and both current and v1 tree interfaces.
- Share the Azure branch item cache between Resources and Focused Resources, but keep each view's root
  cache-invalidation flag independent.
- Fire the narrowest valid refresh. A branch model event should refresh its wrapper; a resource provider
  event or grouping/configuration change may require a broader refresh.
- Dispose provider listeners, emitters, caches, watchers, and views with their owner.
- Add focused tests for IDs, context values, provider replacement/removal, change events, grouping, and
  cross-view refresh behavior.
