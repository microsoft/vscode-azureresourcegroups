---
description: 'Maintain resource and branch provider identity, grouping, caching, refresh, and compatibility across Azure views.'
applyTo: "src/tree/**, src/api/ResourceProviderManagers.ts, src/api/DefaultAzureResourceProvider.ts, src/commands/explorer/**, src/commands/focus/**, src/commands/revealResource.ts, test/grouping.test.ts, test/focusGroup.test.ts, test/ResourceGroupGroupingItem.test.ts, test/api/*Provider*.test.ts, test/api/focusResourceGroup.test.ts"
---

# Resource trees and providers

This guide covers the generic resource views. For `src/tree/project`, also follow the Copilot on
Rails guides; that progress tree is driven by project artifacts, not ARM resource enumeration.

## Identity and provider boundaries

- Resource providers enumerate models; branch data providers describe contributed subtrees.
  Preserve that separation and lazy provider activation. Use the existing default providers when a
  resource has no extension-specific branch provider.
- Follow `ResourceTreeDataProviderBase`, `BranchDataItemWrapper`, `BranchDataItemCache`,
  `TreeItemStateStore`, and `wrapTreeForVSCode` when changing node behavior. Do not apply a second
  state wrapper to a contributed branch item or bypass the cache when reporting provider changes.
- Keep IDs stable across refreshes and display-label/localization changes. Use raw resource-type
  keys for grouping IDs, not user-facing labels; `test/grouping.test.ts` explicitly protects this.
- Account/tenant-qualified tree IDs are not interchangeable with ARM IDs. Use
  `src/tree/azure/idPrefix.ts` where qualified IDs are expected, and preserve case-insensitive ARM
  lookup and existing prefix handling in `findItemById`. Test accounts or tenants that expose the
  same subscription/resource rather than assuming a subscription ID uniquely identifies a node.
- Cached wrappers may be reused while their underlying model is replaced. Preserve
  `BranchDataItemCache.createOrGetItem` behavior so provider refreshes do not retain stale models
  or break selection, reveal, and command arguments.

## Refresh and commands

- Azure Resources and Focus share a branch-item cache but have separate refresh events; Workspace,
  Tenants, and Activity Log have their own providers/refresh paths. Refresh every affected surface
  without turning all targeted updates into full reloads.
- Distinguish the `refreshTree` toolbar commands (including cache-clear flags) from node-level
  `refresh`. In `registerCommands.ts`, refreshing a grouping node refreshes its parent so the
  resource list is fetched again; legacy branch wrappers also refresh their `AzExtTreeItem`.
- Keep Focus filtering and grouping semantics aligned with the main Azure tree. Check group-by
  resource group, type, location, and ARM tag when a shared grouping helper changes.
- Preserve node unwrapping at command boundaries. Commands invoked from contributed items may
  receive wrappers or legacy items; check the existing command registration and type guards rather
  than assuming all nodes are one concrete class.
- Preserve loading, signed-out/empty, invalid-item, and error states. An enumeration failure must
  not look like a successfully loaded empty subscription. Dispose provider listeners and view/state
  subscriptions through the owning registration.

## Regression coverage

Use `test/api/mockServiceFactory.ts` and `MockAzureSubscriptionProvider` for credential-free resource
trees. Extend the nearest grouping, focus, resource-group, workspace-provider, or branch-provider
test. Assert IDs and the affected refresh/reveal result, not only the rendered label. Include
replacement models, empty results, account/tenant isolation, or legacy wrapping when those are the
changed behavior.
