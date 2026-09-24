# Multi-Service Orchestration

> Run when `classify.md` finds **2+ service roots**, before inventory scanning.

---

## Service ID Assignment

Derive short kebab-case ID per service root. Prefer project manifest name; otherwise use directory name.

| Runtime | Manifest Source | Field |
|---------|----------------|-------|
| `node-ts`, `node-js` | `package.json` | `"name"` |
| `dotnet` | `*.csproj` | `<AssemblyName>` or filename |
| *Other* | Service directory name | Fallback without manifest name |

On ID collision, append project type (e.g. `payments-api` becomes `payments-api-functions`).

---

## Emulator Deduplication

Collect all services' emulator lists. Each emulator appears **once** in plan Emulators table, even when shared.

---

## Partial Configuration

Before planning, check each service root's existing debug config.

| State | Plan Action |
|-------|------------|
| Fully configured | Skip |
| Partially configured | Generate only missing artifacts |
| Unconfigured | Full generation |

---

## Compound Debug Configuration

Required for 2+ service roots, including Frontend SPAs.

### Startup Dependencies

If a frontend SPA proxies to a local backend (detect via [project-types.md](project-types.md) § Backend Proxy Dependencies), record `proxyTarget` service ID on its entry. Compound config orders startup: backends before dependent frontends.
