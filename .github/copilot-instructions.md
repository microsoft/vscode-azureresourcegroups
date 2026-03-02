# Copilot Instructions for Azure Resources Extension

## Repository Overview

This is **vscode-azureresourcegroups** (Azure Resources) - a VS Code extension that provides core Azure resource management functionality. It serves as the "host" extension that other Azure extensions build upon.

## Multi-Repository Workspace

This workspace contains **three related repositories**:

| Repository | Path | Purpose |
|------------|------|---------|
| **vscode-azureresourcegroups** | `vscode-azureresourcegroups/` | Core Azure Resources extension (this repo) |
| **vscode-azurefunctions** | `vscode-azurefunctions/` | Azure Functions extension |
| **vscode-azuretools** | `vscode-azuretools/` | Shared libraries used by both extensions |

### Dependency Flow
```
vscode-azuretools (shared packages)
    ├── @microsoft/vscode-azext-utils
    ├── @microsoft/vscode-azext-azureutils  
    ├── @microsoft/vscode-azext-azureauth
    └── @microsoft/vscode-azext-azureappservice
            ↓
vscode-azureresourcegroups (host extension)
            ↓
vscode-azurefunctions (depends on azureresourcegroups)
```

## When Working on GitHub Issues

### Identifying Which Repo an Issue Belongs To

1. **vscode-azureresourcegroups issues** - Problems with:
   - Azure sidebar/tree view
   - Authentication/sign-in
   - Resource groups, subscriptions, tenants
   - "Open in Portal" functionality
   - Cloud Shell integration
   - Activity log
   - Resource grouping/filtering

2. **vscode-azurefunctions issues** - Problems with:
   - Function Apps (create, deploy, configure)
   - Local function development
   - Function templates
   - Durable Task Scheduler
   - App settings specific to Functions
   - Deployment slots

3. **vscode-azuretools issues** - Problems with:
   - Shared UI patterns (wizards, pickers)
   - Telemetry
   - Error handling utilities
   - Tree item base classes
   - App Service shared functionality

## Key Source Directories (This Repo)

| Directory | Purpose |
|-----------|---------|
| `src/tree/` | Azure tree view items and providers |
| `src/commands/` | Command implementations |
| `src/api/` | Public API exposed to other extensions |
| `src/chat/` | GitHub Copilot chat participant integration |
| `src/cloudConsole/` | Azure Cloud Shell integration |
| `src/services/` | Azure service clients and wrappers |
| `src/managedIdentity/` | Managed identity functionality |
| `api/` | API package published for other extensions |

## Important Files

- `src/extension.ts` - Extension entry point
- `src/extensionVariables.ts` - Global extension state
- `src/hostapi.v2.internal.ts` - Internal host API for child extensions
- `package.json` - Extension manifest, commands, settings
- `package.nls.json` - Localized strings

## Coding Guidelines

### Never Modify
- `main.js` - Auto-generated bundle, never edit directly

### Build Commands
```bash
npm run build          # Full build (esbuild + type check)
npm run build:esbuild  # Bundle only
npm run build:check    # Type check only
npm run lint           # ESLint
npm run test           # Run tests
```

### Extension Patterns

1. **Commands** are registered in `src/commands/` and declared in `package.json`
2. **Tree items** extend classes from `@microsoft/vscode-azext-utils`
3. **Wizards** use the wizard pattern from `vscode-azext-utils`
4. **Telemetry** - wrap actions with `callWithTelemetryAndErrorHandling`

### When Fixing Bugs

1. Check if the issue is in shared code (`vscode-azuretools`) vs extension-specific
2. Look for related tree items in `src/tree/`
3. Check command implementations in `src/commands/`
4. Verify the fix doesn't break the public API in `api/`

### When Implementing Features

1. Follow existing patterns in nearby code
2. Add commands to both `package.json` and `src/commands/`
3. Use localization via `package.nls.json` for user-facing strings
4. Add telemetry for new user actions
5. Consider impacts on dependent extensions (vscode-azurefunctions)

## Testing

- Unit tests are in `test/`
- Run with `npm test`
- Tests use `@vscode/test-electron`

## Common Shared Packages

From `vscode-azuretools`:
- `@microsoft/vscode-azext-utils` - Core utilities, tree items, wizards
- `@microsoft/vscode-azext-azureutils` - Azure-specific utilities
- `@microsoft/vscode-azext-azureauth` - Authentication handling
