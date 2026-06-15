# Project Type: Frontend SPA

Reference guide for local development setup of frontend single-page application projects.

> All SPA frameworks share the same VS Code debug configuration shape: browser debugger type (e.g., `chrome`, `msedge`), `launch` request mode, dev server as a prerequisite task. The per-framework differences — runtime, startup command, default port, and background problem matcher — are resolved from the Framework Lookup Table below.

---

## Detection Signals

Match against these signals to classify a workspace root as a frontend SPA. If the workspace clearly is an SPA but doesn't match a specific signal below, still classify it as Frontend SPA — use the Framework Lookup Table's fallback row for configuration.

| Signal | Notes |
|--------|-------|
| `vite.config.*` or `vite` in devDependencies | Vite-based SPA |
| `next.config.*` or `next` in dependencies | Next.js app |
| `angular.json` | Angular app |
| `react-scripts` in dependencies | Create React App |
| `*.razor` files + `Microsoft.AspNetCore.Components.WebAssembly` in `*.csproj` | Blazor WASM |

---

## Prerequisites

No project-type-specific tools required. Browser debugging uses VS Code's built-in capabilities. Runtime prerequisites (e.g., Node.js) are listed in `runtimes/{rt}.md § Prerequisites`.

---

## Runtime Support Matrix

Runtime support for Frontend SPAs is tracked per-framework in the **Framework Lookup Table** below. Each row's `Status` column indicates implementation readiness.

---

## Dependency Discovery

Frontend SPAs communicate with backend services via HTTP during local development — they do not connect to Azure emulators directly. In monorepo setups, Azure service dependencies (storage, databases, etc.) are handled by the backend project type. In standalone SPA projects, the backend may already be running as a deployed service or a separate local process — no emulator setup is needed for the SPA itself.

---

## Backend Proxy Dependencies

Frontend dev servers often proxy API requests to a local backend during development. In multi-service setups, if a proxy config is detected pointing to another local service, that backend service's startup task should be a dependency of the frontend's dev server task to prevent `ECONNREFUSED` errors during initial page load.

| Framework | Proxy Config Location |
|-----------|----------------------|
| Vite | `server.proxy` in `vite.config.*` |
| Create React App | `"proxy"` field in `package.json` |
| Angular | `proxy.conf.json` |
| Next.js | `rewrites()` in `next.config.*` |

---

## Startup Command

The startup command varies per framework. See the **Framework Lookup Table** below for the specific command for each detected framework (e.g., `npm run dev` for Vite, `npm start` for Angular).

---

## Framework Lookup Table

Use this table to resolve per-framework values when generating the VS Code configuration. The `Status` column is the source of truth for implementation readiness — if a framework is not ✅ Implemented, emit a `⚠️ LIMITED SUPPORT:` warning per [limited-support.md](../../limited-support.md).

> **To add a new framework:** add a row with its runtime, detection signal, startup command, default port, problem matcher patterns, and status.

| Framework | Runtime | Detection | Startup Command | Default Port | Ready Pattern (begins) | Ready Pattern (ends) | Status |
|-----------|---------|----------|-----------------|--------------|----------------------|---------------------|--------|
| Vite | node | `vite.config.*` or `vite` in devDependencies | `npm run dev` | 5173 | `VITE` | `Local:` | ✅ Implemented |
| Next.js | node | `next.config.*` or `next` in dependencies | `npm run dev` | 3000 | `\s*ready` | `started server on` | ✅ Implemented |
| Angular | node | `angular.json` | `npm start` | 4200 | `Compiling` | `Compiled successfully` | ✅ Implemented |
| Create React App | node | `react-scripts` in dependencies | `npm start` | 3000 | `Starting the development server` | `Compiled` | ✅ Implemented |
| Blazor WASM | dotnet | `*.razor` + `WebAssembly` SDK in `*.csproj` | `dotnet watch run` | 5000 | `Now listening on` | `Application started` | 🔲 Planned |
| other | — | No match | — | — | — | — | [limited-support.md](../../limited-support.md) |

> ⚠️ **ANSI escape codes:** Dev servers often wrap output in color codes (e.g., `\x1b[32m...\x1b[0m`). Prefer plain-text anchors that appear outside styled regions (e.g., `Local:` instead of `ready in \d+`) to avoid regex mismatches.

---

## Runtime Wiring

<!-- For Frontend SPAs, all configuration comes from this file — the Framework Lookup Table and VS Code Debug Configuration.
     Browser-based projects do not use runtimes/{rt}.md for debugger type or build chain.
     See generate.md § Source Ownership for the server-side vs browser distinction. -->

| Startup command | Startup task label | Task type | Problem matcher | Request Mode |
|----------------|-------------------|-----------|-----------------|--------------|
| From Framework Lookup Table | `{id} dev` | `shell` | From Framework Lookup Table | `launch` |

### VS Code Debug Configuration

The request mode is always `launch` (VS Code opens the browser). Default to `chrome` — the user can change the browser in the plan before approval.

Look up the launch configuration template from the corresponding adapter file in [`debug-adapters/`](debug-adapters/):

| Browser / Adapter | Adapter File | Status |
|-------------------|-------------|--------|
| Chromium (Chrome, Edge, etc.) | [debug-adapters/chromium.md](debug-adapters/chromium.md) | ✅ Implemented |
| Blazor WASM (.NET) | [debug-adapters/blazorwasm.md](debug-adapters/blazorwasm.md) | 🔲 Planned |
| ∞ | [debug-adapters/_template.md](debug-adapters/_template.md) | — |

> **To add a new debug adapter:** copy `debug-adapters/_template.md` to `debug-adapters/{adapter}.md` and add a row to this table.

### VS Code Task Configuration

The top-level task is the framework's dev server. No runtime build chain — the dev server handles compilation internally. The task label follows the pattern `"{id} dev"`.

```json
{
  "type": "shell",
  "label": "{id} dev",
  "command": "{command from Framework Lookup Table}",
  "options": { "cwd": "${workspaceFolder}/{service-root}" },
  "isBackground": true,
  "runOptions": { "instanceLimit": 1, "instancePolicy": "silent" },
  "problemMatcher": {
    "owner": "{framework name, lowercased}",
    "pattern": { "regexp": "^$" },
    "background": {
      "activeOnStart": true,
      "beginsPattern": "{Ready Pattern (begins) from Framework Lookup Table}",
      "endsPattern": "{Ready Pattern (ends) from Framework Lookup Table}"
    }
  }
}
```

### Connection Strings

Not applicable — Frontend SPAs do not connect to Azure emulators directly. In monorepo setups, connection strings are owned by the backend project type.

---

## API Test Collections

Not applicable — Frontend SPAs do not expose API endpoints. In monorepo setups, API test collections are owned by the backend project type. See [api-test-collections.md](../../api-test-collections.md) for backend patterns.

---

## VS Code Extension Recommendations (`.vscode/extensions.json`)

No project-type-specific extensions. Browser debugging uses VS Code's built-in capabilities.

> Framework-specific extensions (if any) would be listed here. Runtime extensions are listed in `runtimes/{rt}.md`.

---

## VS Code Workspace Settings (`.vscode/settings.json`)

No project-type-specific workspace settings.

---

## Validation Signals

Used by [validation.md](../../validation.md) during Phase 3 to verify the generated debug configuration works.

### Ready Signal

Use the `Ready Pattern (begins)` and `Ready Pattern (ends)` columns from the **Framework Lookup Table** above for the detected framework. The ready signal is observed on stdout of the dev server task.

### HTTP Verification

| Curl Target | Expected Status | Notes |
|-------------|-----------------|-------|
| `http://localhost:{dev-server-port}` | `200` or `301` | Use the resolved dev server port from the Framework Lookup Table. Validates the dev server started — do NOT launch a browser. Framework-specific redirects (e.g., `301` for Next.js) are acceptable. |

---

## Checklist — Frontend SPA Project Validation

After generating `launch.json` and `tasks.json`, verify the following were produced correctly:

1. ✅ Dev server task exists in `tasks.json` with a custom `background` problem matcher using the correct begin/end patterns from the Framework Lookup Table
2. ✅ `launch.json` uses the correct browser debug adapter (e.g., `chrome`) with `"request": "launch"`
3. ✅ `launch.json` `url` matches the framework's default port from the Framework Lookup Table
4. ✅ `launch.json` `preLaunchTask` points to the dev server task

> Runtime-specific checks (e.g., build task, debugger type) are defined in `runtimes/{rt}.md`.
