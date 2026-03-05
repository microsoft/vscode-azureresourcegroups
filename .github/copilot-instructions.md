# Copilot Instructions for vscode-azureresourcegroups

## Build, Lint, and Test

```bash
npm run build          # esbuild bundle + TypeScript type check (parallel)
npm run build:esbuild  # esbuild only
npm run build:check    # tsc --noEmit only
npm run lint           # ESLint (zero warnings enforced)
npm run test           # All tests via @vscode/test-cli
npm run package        # Build VSIX
```

Run a single test file by filtering with `--grep`:

```bash
npm test -- --grep "test name pattern"
```

Node.js 22.18+ required (see `.nvmrc`).

## Architecture

This is the **Azure Resources** VS Code extension (`ms-azuretools.vscode-azureresourcegroups`). It provides the main Azure tree views and acts as a **host extension** that other Azure extensions plug into.

### Extension entry point

`src/extension.ts` `activate()` initializes five tree views (Resources, Workspace, Focus, Tenants, Activity Log), registers 170+ commands, sets up Azure auth, and exposes a public API for dependent extensions.

### Public API (`api/` package)

The top-level `api/` directory is an independently published npm package (`@microsoft/vscode-azureresources-api`). It defines the **contract** (interfaces, types, enums) that dependent Azure extensions consume. `src/api/` contains the **implementation** of those interfaces. The API is versioned (v1.5 compatibility, v2, v3) and exposed via `AzureExtensionApiFactory` during activation.

To release the API package: bump version, update changelog, run `npm run api-extractor`, and trigger the `api-publish` GitHub Action.

### Manager + Provider extensibility pattern

The core extensibility model uses Manager + Provider pairs:

- **Providers** (`ResourceProvider`, `BranchDataProvider`) supply data for tree nodes
- **Managers** (`ResourceBranchDataProviderManagerBase`) hold a map of registered providers by resource type, with lazy activation — a default provider is used until the owning extension activates

This pattern repeats across all four tree domains: Azure resources, Workspace, Tenants, and Activity Log.

### Internal host APIs

`src/hostapi.v2.internal.ts` and `src/hostapi.v4.internal.ts` extend the public API with internal-only methods (e.g., `registerAzureResourceProvider`, activity logging, credential validation). These are consumed by sibling Azure extensions but not published.

### Global state (`src/extensionVariables.ts`)

The `ext` namespace holds all runtime singletons: tree instances, subscription provider factory, Azure tree state store, focused group, and test overrides. Dependency injection for tests is done via `ext.testing.*` properties.

## Key Conventions

### Telemetry wrapping

All command handlers use `callWithTelemetryAndErrorHandling()` from `@microsoft/vscode-azext-utils`. Tree provider functions are wrapped via `wrapFunctionsInTelemetry()` with a `callbackIdPrefix` (e.g., `'branchDataProvider.'`).

### Command registration

Commands are registered in `src/commands/registerCommands.ts` using two helpers from `@microsoft/vscode-azext-utils`:
- `registerCommand()` for simple commands
- `registerCommandWithTreeNodeUnwrapping()` for commands that receive `BranchDataItemWrapper` tree items

### Tree item pattern

All tree items implement the `ResourceGroupsItem` interface (`getChildren`, `getTreeItem`). Items go through `BranchDataItemCache` for performance and `TreeItemStateStore` for state management.

### Event-driven refresh

Tree views coordinate via event emitters. Separate commands exist for full-tree refresh vs. node-specific refresh. Changes in providers trigger `onDidChangeTreeData` events that propagate through the manager layer.

### Test setup

Tests activate the extension by executing `azureResourceGroups.refresh`. A test API (version `99.0.0`) is conditionally exposed when `VSCODE_RUNNING_TESTS` is set. Tests wrap context with `TestUserInput` to catch unexpected UI prompts. Nightly tests use Azure DevOps federated credentials via the `AzCode_UseAzureFederatedCredentials` env var.

### Changelog format

Entries follow: `* [[PR#]](url) Description` under sections `### Added`, `### Changed`, `### Fixed`, `### Engineering`, with header `## X.Y.Z - YYYY-MM-DD`.
