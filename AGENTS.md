# Architecture and ownership map

For implementation, testing, and review rules, read
[.github/copilot-instructions.md](.github/copilot-instructions.md). This map identifies code ownership,
not additional product requirements. Start with the narrowest affected route.

## Trace a feature

`package.json` contribution -> `src/extension.ts` / command registration -> handler or API adapter ->
resource/subscription service or branch provider -> tree refresh, activity/output, or webview -> test.

| Area | Start here | Related coverage / guidance |
| --- | --- | --- |
| Activation, shared services, disposal | `src/extension.ts`, `src/extensionVariables.ts`, `src/constants.ts` | `test/global.test.ts`; [repository rules](.github/copilot-instructions.md) |
| Commands, menus, settings, localization | `package.json`, `package.nls.json`, `src/commands/registerCommands.ts`, `src/utils/localize.ts` | Handlers in `src/commands`; [Azure workflows](.github/instructions/azure-workflows.instructions.md) |
| Client API and authenticated host API | `api/src/index.ts`, `api/src/extensionApi.ts`, `src/api`, `src/hostapi.v2.internal.ts`, `src/hostapi.v4.internal.ts` | `test/api`, `test/wrapFunctionsInTelemetry.test.ts`; [API guide](.github/instructions/resource-api.instructions.md) |
| Resources and Focus views | `src/tree/azure`, `src/tree/BranchDataItemCache.ts`, `src/tree/TreeItemState.ts` | `test/grouping.test.ts`, `test/focusGroup.test.ts`, `test/ResourceGroupGroupingItem.test.ts`; [tree guide](.github/instructions/resource-trees.instructions.md) |
| Workspace, Accounts & Tenants, Activity Log trees | `src/tree/workspace`, `src/tree/tenants`, `src/tree/activityLog`, `src/api/ResourceProviderManagers.ts` | `test/api/workspaceResourceProvider.test.ts`, `test/authAccountStateManager.test.ts`; [tree guide](.github/instructions/resource-trees.instructions.md) |
| Subscription/authentication and ARM access | `src/services/getSubscriptionProviderFactory.ts`, `src/services/AzureResourcesService.ts`, `src/utils/azureClients.ts` | `test/api/MockAzureSubscriptionProvider.ts`, `test/api/mockServiceFactory.ts`, `test/nightly`; [Azure workflows](.github/instructions/azure-workflows.instructions.md) |
| Resource-group actions, tags, managed identity | `src/commands/createResourceGroup.ts`, `src/commands/deleteResourceGroup`, `src/commands/tags`, `src/managedIdentity` | `test/getTagDiagnostics.test.ts`, `test/nightly`; [Azure workflows](.github/instructions/azure-workflows.instructions.md) |
| Cloud Shell terminals and IPC | `src/cloudConsole`, `src/cloudConsole/cloudShellChildProcess` | `test/cloudConsole.test.ts`, `test/ipc.test.ts`; [Azure workflows](.github/instructions/azure-workflows.instructions.md) |
| Chat and in-process MCP registration | `src/chat`, `src/chat/tools/registerMcpTools.ts`, `src/extension.ts` | Tool implementations under `src/chat/tools`; CoR tools share the pipeline below |
| Copilot on Rails project pipeline | `src/commands/copilotOnRails`, `src/chat/tools/copilotOnRails`, `src/webviews/copilotOnRails`, `src/tree/project`, `src/utils/copilotOnRails` | `test/copilotOnRails`, `docs/copilot-create-project.md`; [pipeline guide](.github/instructions/copilot-on-rails.instructions.md) |
| Shipped agent prompts and eval contracts | `resources/agents`, `evals/check-agent-drift.ts`, `evals/msbench`, `.github/workflows/agent-contracts.yml` | `evals/grader-certification`; [evaluation guide](.github/instructions/agent-evals.instructions.md) |

## Important boundaries

- `api/src` is the client library/contract; `src/api` implements the host and compatibility layers.
  `api/docs` contains documentation snapshots, not implementation imports.
- Resource providers enumerate resources; branch data providers supply their tree representation.
  Azure, Focus, Workspace, Tenants, and Activity Log are separate refresh surfaces. The project
  progress tree is part of Copilot on Rails, not the generic resource-provider pipeline.
- Copilot on Rails has extension-side controllers, browser-side React views, shared artifact
  types/parsers, and shipped agent instructions. Its workspace artifacts are untrusted inputs.
  Preserve the existing [artifact-security](.github/instructions/copilot-on-rails-artifact-security.instructions.md)
  and [documentation-sync](.github/instructions/copilot-on-rails-docs.instructions.md) contracts.
- `esbuild.mjs` builds the extension, Cloud Shell launcher, and CoR webview bundle. Root, `api`,
  `evals`, and React-view TypeScript configurations have different responsibilities.
- Repo-wide ownership is recorded in `.github/CODEOWNERS`; do not infer a new team or API owner
  from this navigation map.
