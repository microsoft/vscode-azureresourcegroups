# Node.js — Debug & Build Configuration

> Covers **JavaScript** + **TypeScript**. Same debugger properties; different build chains.

## Prerequisites

| Tool | Detection Command | Required For | Install Link |
|------|-------------------|-------------|-------------|
| Node.js | `node --version` | All Node projects | [nodejs.org](https://nodejs.org/) |
| npm | `npm --version` | Dependency management | (bundled with Node) |

---

## Debugger Properties

| Property | Value | Notes |
|----------|-------|-------|
| Debug protocol | `Node Inspector` | V8 inspector over WebSocket |
| VS Code debugger type | `node` | Maps Node Inspector to built-in VS Code Node debugger |
| Base debug port | `9229` | Default Node.js inspector port |
| Auto-restart | `true` | Reattach after host restart on file changes |

### `outFiles` (node-ts only — REQUIRED)

Every TypeScript Node.js `launch.json` attach config **must** include `outFiles` targeting compiled JavaScript. Without it, VS Code cannot find `.js.map`; `.ts` breakpoints do not trigger.

**Derivation:** Read project `tsconfig.json` output directory:
1. Check `compilerOptions.outDir`, compiled root (e.g., `"outDir": "./dist"`)
2. Build glob `${workspaceFolder}/{service-root}/{outDir}/**/*.js`
3. Without `outDir`, use project root `${workspaceFolder}/{service-root}/**/*.js`

> `{service-root}` is workspace-root-relative project path. Single-project: empty (`${workspaceFolder}/dist/**/*.js`). Monorepo: nested path (e.g., `${workspaceFolder}/services/functions/dist/**/*.js`).

**Example:**
```json
{
  "name": "My API (debug)",
  "type": "node",
  "request": "attach",
  "port": 9229,
  "restart": true,
  "outFiles": ["${workspaceFolder}/services/functions/dist/**/*.js"],
  "preLaunchTask": "{service-id}: func host start"
}
```

> `preLaunchTask` uses canonical `{service-id}:` task prefix; see [generate.md § Service ID Derivation](../generate.md). Example is `functions-api`, resolving to `functions-api: func host start`.

> **Verify:** Debugged TypeScript `tsconfig.json` needs `"sourceMap": true` in `compilerOptions`. Otherwise `.ts` breakpoints cannot bind compiled `.js` and stay gray/unverified despite attachment. Build/watch must run **before** startup so output exists at attach.

### VS Code Problem Matchers

| Variant | Watch Problem Matcher | Build Problem Matcher |
|---------|----------------------|----------------------|
| node-ts | `$tsc-watch` | `$tsc` |
| node-js | — | — |

> **Monorepo / multi-service:** Assign each Node service sequential debug port from project-type Runtime Wiring base. See [multi-service.md](../multi-service.md).

---

## Variant Detection

| Signal | Variant | Notes |
|--------|---------|-------|
| `tsconfig.json` present | **node-ts** | TypeScript; compile required |
| `package.json` without `tsconfig.json` | **node-js** | JavaScript; no compile |

---

## Build Chain

Runtime owns install, clean, build, watch. Project type Runtime Wiring supplies startup and dependency wiring.

> **Task label scoping:** Prefix every task label with service ID (e.g., `functions-api: npm watch`). See [generate.md § Service ID Derivation](../generate.md).

### Build Commands

#### node-ts (TypeScript)

```
"{service-id}: {startup task}"              ← from project-types/{type}.md Runtime Wiring
       ├── dependsOn: "{service-id}: npm watch"
       │                └── dependsOn: "{service-id}: npm clean"
       │                               └── dependsOn: "{service-id}: npm install"
       └── dependsOn: "Start Emulators"     ← only when emulators are required
```

| Step | Task Label | Command | Purpose | Background? |
|------|-----------|---------|---------|------------|
| install | `{service-id}: npm install` | `npm install` | Install dependencies | No |
| clean | `{service-id}: npm clean` | `npm run clean` | Clean build output | No |
| watch | `{service-id}: npm watch` | `npm run watch` | Run `tsc --watch` incremental builds | ✅ Yes |
| build | `{service-id}: npm build` | `npm run build` | One-shot build (used outside debug flow) | No |

#### node-js (JavaScript)

```
"{service-id}: {startup task}"              ← from project-types/{type}.md Runtime Wiring
       ├── dependsOn: "{service-id}: npm install"
       └── dependsOn: "Start Emulators"     ← only when emulators are required
```

| Step | Task Label | Command | Purpose | Background? |
|------|-----------|---------|---------|------------|
| install | `{service-id}: npm install` | `npm install` | Install dependencies | No |

> No compile, clean, or watch; JavaScript runs directly.

> **Monorepo / alternative package managers:** Adjust for `yarn`, `pnpm`, or monorepo layout. Preserve **install → [clean → build/watch →] startup task**; compile only TypeScript.

See [generate.md](../generate.md) § Task `runOptions` Rules for rendering build steps into VS Code tasks.


---

## Convenience Scripts

Plan Convenience Scripts defines WHICH scripts; this section defines HOW Node.js registers them.

**Script runner:** `package.json` `"scripts"` block
**Run command pattern:** `npm run {script-name}`

### Script Format

Add each shell command to `package.json` `"scripts"`. Example:

```json
{
  "{script-name}": "{shell command}"
}
```

### Common Script Implementations

Use these for planned scripts:

| Script Purpose | Typical Command | Notes |
|---------------|-----------------|-------|
| Start emulators | `docker compose up -d` | Idempotent; safe to re-run |
| Stop emulators | `docker compose down` | Stops and removes containers |
| Clean emulator data | `docker compose down -v && rimraf {data-dirs}` | `-v` (`--volumes`) also removes **named volumes** (e.g. Postgres's `postgres_data`). `{data-dirs}` = space-separated `./.{name}` **bind-mount** directories from `docker-compose.yml` `volumes:` mounts (e.g., `.azurite`). Use `rimraf` cross-platform; requires `rimraf` in `devDependencies`. See [generate.md § Dependency Availability](../generate.md). |
| Run migrations | `{migration tool CLI command}` | Derive via [migrations.md](../migrations.md) |

---

## VS Code Extension Recommendations (`.vscode/extensions.json`)

No recommended extensions.

---

## VS Code Workspace Settings (`.vscode/settings.json`)

<!-- Runtime-contributed settings; generate.md aggregates with project-type settings into .vscode/settings.json. -->

| Setting | Value | Why |
|---------|-------|-----|
| `files.exclude: **/node_modules` | `true` | Hide large/noisy dependency tree |

> Exclusion reduces workspace noise. Deep-merge with existing `files.exclude`; see [generate.md § VS Code Workspace Settings](../generate.md).

---

## Checklist — Node.js Runtime Validation

> ⛔ **MANDATORY — Phase 3 after all artifacts.** Verify every item; never skip, assume, or approximate.

After VS Code config generation, verify:

### Post-Generation Checks

1. ✅ `launch.json` uses `"type": "node"` with the correct debug port
2. ✅ For TypeScript: `launch.json` includes `"outFiles"` derived from `tsconfig.json` `outDir` (e.g., `["${workspaceFolder}/{service-root}/{outDir}/**/*.js"]`)
3. ✅ For TypeScript: `tsconfig.json` has `"sourceMap": true` — without it, breakpoints in `.ts` files appear as gray (unverified) dots
4. ✅ For TypeScript: watch task exists in `tasks.json` with `$tsc-watch` problem matcher
5. ✅ For TypeScript: build chain follows install → clean → watch dependency order

### Live Validation Checks

Run during Phase 3 validation ([validation.md](../validation.md) Step 7), after ready signal:

1. ✅ TypeScript: require `tsconfig.json` `"sourceMap": true` in `compilerOptions`. If missing, add `"sourceMap": true`; rerun build before config ✅

> Functions host or `--inspect` handles Node Inspector port (`9229`) automatically.

> `project-types/{type}.md` defines project-type checks (e.g., `{service-id}: func host start`, connection strings).
