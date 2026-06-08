# Multi-Service Orchestration

> Runs when `classify.md` finds **2+ service roots**, before inventory scanning begins.

---

## Service ID Assignment

Derive a short kebab-case ID per service root. Use project manifest name if available, otherwise fall back to directory name.

| Runtime | Manifest Source | Field |
|---------|----------------|-------|
| `node-ts`, `node-js` | `package.json` | `"name"` |
| `dotnet` | `*.csproj` | `<AssemblyName>` or filename |
| *Other* | Service directory name | Fallback when no manifest name exists |

If two IDs collide, append the project type (e.g. `payments-api` becomes `payments-api-functions`).

---

## Emulator Deduplication

Collect emulator lists from all services. Each emulator appears **once** in the plan's Emulators table — multiple services may depend on the same emulator.

---

## Partial Configuration

Check each service root for existing debug config before planning.

| State | Plan Action |
|-------|------------|
| Fully configured | Skip |
| Partially configured | Generate only missing artifacts |
| Unconfigured | Full generation |

---

## Compound Debug Configuration

Required when 2+ service roots are detected (including Frontend SPAs).

### Startup Dependencies

If a frontend SPA has a proxy pointing to a local backend (detected via [project-types.md](project-types.md) § Backend Proxy Dependencies), record the `proxyTarget` service ID on that service entry. The compound config uses this to order startup (backends before frontends) that depend on them.
