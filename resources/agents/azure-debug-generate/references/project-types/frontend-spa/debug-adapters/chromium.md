# Chromium — Browser Debug Adapter

> **Chromium-based browsers** (Chrome, Edge, etc.) share the launch configuration; only `type` differs.

## VS Code Debugger Type

| Browser | VS Code Debugger Type | Required Extension |
|---------|----------------------|-------------------|
| Chrome | `chrome` | None — built-in |
| Edge | `msedge` | None — built-in |

Pick `type` from the browser recorded in plan Prerequisites; see [prerequisites.md](../../../../../shared-references/prerequisites.md) § Browser detection.

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
| `type` | Browser Debugger Type above, matching plan Prerequisites (`chrome` for Chrome, `msedge` for Edge) |
| `url` | Default Port in [frontend-spa.md § Framework Lookup Table](../frontend-spa.md) |
| `webRoot` | **Framework root** — see `webRoot` Resolution below |
| `preLaunchTask` | `{id} dev` — dev server task from [frontend-spa.md § VS Code Task Configuration](../frontend-spa.md) |

---

## `webRoot` Resolution

> **Universal rule:** `webRoot` MUST be the **framework root directory** containing its config file, NEVER a subdirectory. Dev server URL paths are relative to this root; setting `webRoot` to a subdirectory such as `src/` doubles paths and breaks breakpoint resolution.

Applies to **all frameworks** whose config file is above `src/`.

| Framework | Config file that defines the root | `webRoot` value |
|-----------|----------------------------------|-----------------|
| Vite | `vite.config.*` | Directory containing `vite.config.*` |
| CRA | `package.json` (with `react-scripts`) | Directory containing `package.json` |
| Angular | `angular.json` | Workspace root (or project root in monorepo) |
| Next.js | `next.config.*` | Directory containing `next.config.*` |
| Blazor WASM | `*.csproj` | Directory containing `*.csproj` |

> ⛔ **Before writing `webRoot`**, verify `{service-root}` contains the framework config file (e.g., `vite.config.ts`, `angular.json`). If plan Service Root is a `src/` subdirectory without it, walk up to the containing parent.

---

## Notes

- `"request": "launch"` opens a new CDP-enabled browser window; breakpoints work immediately.
- `webRoot` maps served files to workspace sources for breakpoint resolution.
- Chrome and Edge share CDP behavior.

---

## Troubleshooting — first-launch browser failure

> ⚠️ First debug launch (**F5**) may fail to open a browser or attach. Usually this is **browser process / first-run state, NOT defective generated `launch.json`**: (1) browser already running, or (2) one-time development HTTPS certificate prompt interrupts startup after app or emulator TLS/dev-cert setup.

**Don't assume first-launch failure means bad config.** Rewriting correct config (e.g. `launch`→`attach` or a dedicated Edge process task) may target the wrong cause. Try these fixes **first**:

- **Close every debug-browser window** (all Edge or Chrome windows), then retry **F5**. Running browsers are the most common cause.
- If a **development certificate / HTTPS prompt** appeared, accept it, close all browser windows, then retry to apply trust.
- If failure persists, switch config `type` between `msedge` and `chrome` to another installed Chromium browser, or debug inside VS Code with `editor-browser`.
- **Only after those fail**, launch the browser explicitly with a dedicated remote-debugging port and `--user-data-dir`, then change config to `attach`; this heavier approach is the last resort.
