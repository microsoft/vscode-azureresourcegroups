# Project Type: Frontend SPA

Local development reference for frontend single-page applications.

> All SPA frameworks use one VS Code debug shape: browser type (e.g., `chrome`, `msedge`), `launch` request, and dev-server prerequisite task. Resolve runtime, startup command, default port, and background problem matcher from Framework Lookup Table.

---

## Detection Signals

Use these signals to classify a workspace root as Frontend SPA. If clearly an SPA but unmatched, still classify it and use Framework Lookup Table fallback.

| Signal | Notes |
|--------|-------|
| `vite.config.*` or `vite` in devDependencies | Vite-based SPA |
| `next.config.*` or `next` in dependencies | Next.js app |
| `angular.json` | Angular app |
| `react-scripts` in dependencies | Create React App |
| `*.razor` files + `Microsoft.AspNetCore.Components.WebAssembly` in `*.csproj` | Blazor WASM |

---

## Prerequisites

No VS Code extension required; browser debugging uses its built-in adapter. Require installed Chromium browser (Chrome or Edge), captured as Debug prerequisite via [prerequisites.md](../../../../shared-references/prerequisites.md) § Browser detection. Runtime prerequisites (e.g., Node.js): `runtimes/{rt}.md § Prerequisites`.

---

## Runtime Support Matrix

Framework Lookup Table tracks support; each `Status` shows readiness.

---

## Dependency Discovery

Frontend SPAs call backends through HTTP, never Azure emulators directly. In monorepos, backend project type handles Azure dependencies (storage, databases, etc.). Standalone backends may be deployed or separate local processes; SPA needs no emulator setup.

---

## Backend Proxy Dependencies

Dev servers often proxy APIs to local backends. In multi-service setups, when proxy config targets another local service, make its startup task a frontend dev-server dependency to prevent initial-load `ECONNREFUSED`.

| Framework | Proxy Config Location |
|-----------|----------------------|
| Vite | `server.proxy` in `vite.config.*` |
| Create React App | `"proxy"` field in `package.json` |
| Angular | `proxy.conf.json` |
| Next.js | `rewrites()` in `next.config.*` |

---

## Startup Command

Resolve each framework's startup command from **Framework Lookup Table** (e.g., Vite `npm run dev`, Angular `npm start`).

---

## Framework Lookup Table

Use this table for generated VS Code values. `Status` is readiness source of truth; unless ✅ Implemented, emit `⚠️ LIMITED SUPPORT:` per [limited-support.md](../../limited-support.md).

> **To add a new framework:** add runtime, detection, startup command, default port, problem matcher patterns, and status row.

| Framework | Runtime | Detection | Startup Command | Default Port | Ready Pattern (begins) | Ready Pattern (ends) | Status |
|-----------|---------|----------|-----------------|--------------|----------------------|---------------------|--------|
| Vite | node | `vite.config.*` or `vite` in devDependencies | `npm run dev` | 5173 | `VITE` | `Local:` | ✅ Implemented |
| Next.js | node | `next.config.*` or `next` in dependencies | `npm run dev` | 3000 | `\s*ready` | `started server on` | ✅ Implemented |
| Angular | node | `angular.json` | `npm start` | 4200 | `Compiling` | `Compiled successfully` | ✅ Implemented |
| Create React App | node | `react-scripts` in dependencies | `npm start` | 3000 | `Starting the development server` | `Compiled` | ✅ Implemented |
| Blazor WASM | dotnet | `*.razor` + `WebAssembly` SDK in `*.csproj` | `dotnet watch run` | 5000 | `Now listening on` | `Application started` | 🔲 Planned |
| other | — | No match | — | — | — | — | [limited-support.md](../../limited-support.md) |

> ⚠️ **ANSI escape codes:** Dev servers may color output (e.g., `\x1b[32m...\x1b[0m`). Use plain-text anchors outside styled regions (e.g., `Local:` instead of `ready in \d+`) to avoid regex mismatches.

---

## Runtime Wiring

<!-- Frontend SPA configuration comes from this file's Framework Lookup Table and VS Code Debug Configuration.
     Browser projects do not use runtimes/{rt}.md for debugger type or build chain.
     See generate.md § Source Ownership for server-side vs browser distinction. -->

| Startup command | Startup task label | Task type | Problem matcher | Request Mode |
|----------------|-------------------|-----------|-----------------|--------------|
| From Framework Lookup Table | `{id} dev` | `shell` | From Framework Lookup Table | `launch` |

### VS Code Debug Configuration

Request mode is always `launch`; VS Code opens the browser. Use browser recorded during plan prerequisite detection (see [prerequisites.md](../../../../shared-references/prerequisites.md) § Browser detection) and its adapter `type` (`chrome` for Chrome, `msedge` for Edge). User may change it before plan approval.

Get launch template from corresponding file in [`debug-adapters/`](debug-adapters/):

| Browser / Adapter | Adapter File | Status |
|-------------------|-------------|--------|
| Chromium (Chrome, Edge, etc.) | [debug-adapters/chromium.md](debug-adapters/chromium.md) | ✅ Implemented |
| Blazor WASM (.NET) | [debug-adapters/blazorwasm.md](debug-adapters/blazorwasm.md) | 🔲 Planned |
| ∞ | [debug-adapters/_template.md](debug-adapters/_template.md) | — |

> **To add a new debug adapter:** copy `debug-adapters/_template.md` to `debug-adapters/{adapter}.md`; add table row.

### VS Code Task Configuration

Top-level task is framework dev server; it compiles internally, so no runtime build chain. Label: `"{id} dev"`.

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

Not applicable: Frontend SPAs do not directly connect to Azure emulators. In monorepos, backend project type owns connection strings.

---

## API Test Collections

Not applicable: Frontend SPAs expose no API endpoints. In monorepos, backend project type owns API test collections. See [api-test-collections.md](../../api-test-collections.md) for backend patterns.

---

## VS Code Extension Recommendations (`.vscode/extensions.json`)

No project-type extensions; browser debugging is built in.

> List framework extensions here, if any. Runtime extensions: `runtimes/{rt}.md`.

---

## VS Code Workspace Settings (`.vscode/settings.json`)

No project-type workspace settings.

---

## Validation Signals

[validation.md](../../validation.md) uses these in Phase 3 to verify generated debug configuration.

### Ready Signal

Use detected framework's `Ready Pattern (begins)` and `Ready Pattern (ends)` from **Framework Lookup Table**. Observe ready signal on dev-server task stdout.

### HTTP Verification

| Curl Target | Expected Status | Notes |
|-------------|-----------------|-------|
| `http://localhost:{dev-server-port}` | `200` or `301` | Use Framework Lookup Table port. Verify dev server without launching browser. Accept framework redirects (e.g., Next.js `301`). |

---

## Checklist — Frontend SPA Project Validation

After generating `launch.json` and `tasks.json`, verify:

1. ✅ Dev-server task exists in `tasks.json` with custom `background` problem matcher and correct Framework Lookup Table begin/end patterns
2. ✅ `launch.json` uses plan browser adapter (`chrome` or `msedge`) with `"request": "launch"`
3. ✅ `launch.json` `url` matches Framework Lookup Table default port
4. ✅ `launch.json` `preLaunchTask` targets dev-server task

> Runtime checks (e.g., build task, debugger type): `runtimes/{rt}.md`.
