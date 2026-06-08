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
| `webRoot` | Service root from classify phase |
| `preLaunchTask` | `{id} dev` — the dev server task from [frontend-spa.md § VS Code Task Configuration](../frontend-spa.md) |

---

## Notes

- The `"request": "launch"` mode opens a new browser window with CDP debugging enabled — breakpoints work immediately.
- `webRoot` maps the browser's served files back to workspace source files for correct breakpoint resolution.
- Chrome and Edge share the same CDP protocol, so all behavior is identical between them.
