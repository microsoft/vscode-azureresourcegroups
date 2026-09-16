# {Adapter} — Browser Debug Adapter

> **Template** — Copy this file to `{adapter}.md` when adding a new browser debug adapter.

## VS Code Debugger Type

| Browser | VS Code Debugger Type | Required Extension |
|---------|----------------------|-------------------|
| {browser} | `{type}` | {extension or "None — built-in"} |

---

## Launch Configuration

```json
{
  "name": "{id} (debug)",
  "type": "{type}",
  "request": "launch",
  "url": "http://localhost:{port from Framework Lookup Table}",
  "preLaunchTask": "{id} dev"
}
```

| Field | Source |
|-------|--------|
| `type` | VS Code Debugger Type from table above |
| `url` | Default Port from [frontend-spa.md § Framework Lookup Table](../frontend-spa.md) |
| `preLaunchTask` | `{id} dev` — the dev server task from [frontend-spa.md § VS Code Task Configuration](../frontend-spa.md) |

<!-- Add any adapter-specific fields and notes below. -->

---

## Notes

<!-- Document adapter-specific behavior, extra fields, or required extensions here. -->
