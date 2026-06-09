# Chromium — Browser Debug Adapter

> Covers all **Chromium-based browsers** (Chrome, Edge, etc.). The launch configuration is identical — only the `type` field differs.

## VS Code Debugger Type

| Browser | VS Code Debugger Type | Required Extension |
|---------|----------------------|-------------------|
| Chrome | `chrome` — default | None — built-in |
| Edge | `msedge` | None — built-in |

---

## Launch Configuration

```json
{
  "name": "{id} (debug)",
  "type": "{chrome or msedge}",
  "request": "launch",
  "url": "http://localhost:{port from Framework Lookup Table}",
  "webRoot": "${workspaceFolder}/{service-root}",
  "preLaunchTask": "{id} dev"
}
```

| Field | Source |
|-------|--------|
| `type` | Browser Debugger Type from table above — default to `chrome` |
| `url` | Default Port from [frontend-spa.md § Framework Lookup Table](../frontend-spa.md) |
| `webRoot` | **Framework root** — see `webRoot` Resolution below |
| `preLaunchTask` | `{id} dev` — the dev server task from [frontend-spa.md § VS Code Task Configuration](../frontend-spa.md) |

---

## `webRoot` Resolution

> **Universal rule:** `webRoot` must ALWAYS be the **framework root directory** (where the framework's config file lives), NEVER a subdirectory within it. The dev server determines its URL path structure relative to this root. Setting `webRoot` to a subdirectory like `src/` causes path doubling and breaks breakpoint resolution.

For example, a Vite project at `src/web/` with source files in `src/web/src/` serves paths like `/src/pages/Dashboard.tsx`. Chrome resolves breakpoints as `{webRoot}/src/pages/Dashboard.tsx`. If `webRoot` is incorrectly set to `src/web/src`, the resolved path becomes `src/web/src/src/pages/Dashboard.tsx` — a doubled `src/` that breaks all breakpoints.

This applies to **all frameworks** — any framework where the config file lives in a parent directory of `src/` will exhibit the same bug.

| Framework | Config file that defines the root | `webRoot` value |
|-----------|----------------------------------|-----------------|
| Vite | `vite.config.*` | Directory containing `vite.config.*` |
| CRA | `package.json` (with `react-scripts`) | Directory containing `package.json` |
| Angular | `angular.json` | Workspace root (or project root in monorepo) |
| Next.js | `next.config.*` | Directory containing `next.config.*` |
| Blazor WASM | `*.csproj` | Directory containing `*.csproj` |

> ⛔ **Before writing `webRoot`**, verify: does `{service-root}` contain the framework config file (e.g., `vite.config.ts`, `angular.json`)? If the plan's Service Root points to a `src/` subdirectory that does NOT contain the config file, walk up to the parent that does.

---

## Notes

- The `"request": "launch"` mode opens a new browser window with CDP debugging enabled — breakpoints work immediately.
- `webRoot` maps the browser's served files back to workspace source files for correct breakpoint resolution.
- Chrome and Edge share the same CDP protocol, so all behavior is identical between them.
