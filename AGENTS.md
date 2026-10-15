# Azure Resources extension agent guide

This TypeScript VS Code extension hosts the shared Azure Resources experience: Azure, Workspace,
Focused Resources, Accounts & Tenants, Activity Log, Cloud Shell, generic Azure operations, and the
public API used by Azure product extensions. It also contains the Create New Project with Copilot
feature. Use this map to find the narrowest owner before editing; matching
`.github/instructions/*.instructions.md` files contain deeper subsystem rules.

## Architecture

- `src/extension.ts`: activation, shared package initialization, view/provider registration, terminal
  profiles, MCP registration, public API factories, and the test-only API.
- `src/extensionVariables.ts`: process-wide state initialized during activation. Prefer action, wizard,
  provider, or controller state over adding globals.
- `package.json`, `package.nls.json`: commands, views, menus, context expressions, settings, terminal
  profiles, MCP metadata, and localized contribution text.
- `api/src/**`: source for the published `@microsoft/vscode-azureresources-api` package.
- `src/api/**`, `src/hostapi*.internal.ts`: host implementations, API-version factories, authentication,
  telemetry wrappers, and compatibility adapters for older client extensions.
- `src/tree/**`: shared tree framework plus Azure, Workspace, Focused Resources, Accounts & Tenants,
  Activity Log, and Azure Project providers.
- `src/commands/registerCommands.ts`: central command dispatch for ordinary extension commands.
- `src/commands/**`: resource-group operations, grouping/focus, accounts, tags, activities, sovereign
  clouds, navigation, and Copilot on Rails commands.
- `src/services/**`, `src/utils/azureClients.ts`: subscription providers, Resource Graph access, and
  extension-specific Azure SDK factories.
- `src/cloudConsole/**`: Cloud Shell orchestration, child-process launcher, IPC, websocket, and upload
  behavior.
- `src/chat/**`: Ask Azure commands, Activity Log/resource context, and in-process MCP tools.
- `src/managedIdentity/**`: the built-in managed-identity resource branch and role-assignment children.
- `src/webviews/copilotOnRails/**`, `src/utils/copilotOnRails/**`, `src/tree/project/**`,
  `resources/agents/**`: Create New Project with Copilot UI, state, artifact readers, tools, and agents.
- `test/**`: VS Code extension tests. `test/nightly/**` contains gated live-Azure coverage.
- `evals/**`: headless and real-VS-Code evaluations for shipped Copilot agent contracts.

Trace shared-resource behavior end to end before editing:

`package.json` contribution or API call -> extension/API activation -> resource provider -> branch data
provider -> wrapper/cache/tree provider -> command/result/refresh -> tests`.

## Command and contribution wiring

- Change command title, visibility, menu, view, setting, terminal profile, activation event, or `when`
  clause in `package.json`; localize contribution text in `package.nls.json`.
- Change ordinary command arguments and dispatch in `src/commands/registerCommands.ts`; keep product
  behavior in the mapped handler.
- Register tree providers, API factories, the tag file system, Cloud Shell terminal profiles, and MCP in
  `src/extension.ts`.
- Treat `x-azResources` as a cross-extension contract. Its branch, resource, and create-command
  contributions are discovered by `src/utils/getResourceContributions.ts` and activated lazily by
  `src/api/ResourceGroupsExtensionManager.ts`.
- Keep command-palette, tree-menu, programmatic API, and MCP entry points on the same product logic.

## Tests

- `test/api/**`: published/host API behavior, auth sessions, v1 compatibility, branch providers, reveal,
  focus, and workspace resources.
- Top-level `test/*.test.ts`: trees, grouping, accounts, tags, Cloud Shell/IPC, logging, and focused
  utilities.
- `test/copilotOnRails/**`: artifact parsing, webview data, stage state, launch/resume, deployment, and
  telemetry helpers.
- `test/nightly/**`: live Azure create/read/update/delete behavior.
- `evals/**`: agent contracts, safety boundaries, grader certification, and MSBench scenarios.

Place regression coverage beside the nearest suite. Reuse the test API and existing mocks instead of
creating a second extension harness.
