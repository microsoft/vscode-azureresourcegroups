# Node.js — Debug & Build Configuration

> Covers both **JavaScript** and **TypeScript** projects. The debugger properties are identical; only the build chain differs.

## Prerequisites

| Tool | Detection Command | Required For | Install Link |
|------|-------------------|-------------|-------------|
| Node.js | `node --version` | All Node projects | [nodejs.org](https://nodejs.org/) |
| npm | `npm --version` | Dependency management | (bundled with Node) |

---

## Debugger Properties

| Property | Value | Notes |
|----------|-------|-------|
| Debug protocol | `Node Inspector` | V8 inspector protocol over WebSocket |
| VS Code debugger type | `node` | Maps Node Inspector to VS Code's built-in Node debugger |
| Base debug port | `9229` | Default Node.js inspector port |
| Auto-restart | `true` | Re-attach after the host restarts on file changes |

### `outFiles` (node-ts only — REQUIRED)

For any TypeScript Node.js project, the `launch.json` attach configuration **must** include `outFiles` pointing to the compiled JavaScript output. Without it, VS Code cannot locate `.js.map` files and breakpoints set in `.ts` source files will not trigger.

**Derivation:** Read the project's `tsconfig.json` to determine the output directory:
1. Check `compilerOptions.outDir` — this is the compiled output root (e.g., `"outDir": "./dist"`)
2. Construct the glob: `${workspaceFolder}/{service-root}/{outDir}/**/*.js`
3. If `outDir` is not set, fall back to the project root: `${workspaceFolder}/{service-root}/**/*.js`

> `{service-root}` is the path from the workspace root to the project directory. In a single-project workspace this is empty (just `${workspaceFolder}/dist/**/*.js`). In a monorepo it includes the nested path (e.g., `${workspaceFolder}/src/functions/dist/**/*.js`).

**Example:**
```json
{
  "name": "My API (debug)",
  "type": "node",
  "request": "attach",
  "port": 9229,
  "restart": true,
  "outFiles": ["${workspaceFolder}/src/functions/dist/**/*.js"],
  "preLaunchTask": "func: host start"
}
```

> **Verify:** `tsconfig.json` must have `"sourceMap": true` (or not explicitly `false`) so `.js.map` files are generated alongside `.js` files. The build/watch task must run **before** the startup task so compiled output exists when the debugger attaches.

### VS Code Problem Matchers

| Variant | Watch Problem Matcher | Build Problem Matcher |
|---------|----------------------|----------------------|
| node-ts | `$tsc-watch` | `$tsc` |
| node-js | — | — |

> **Monorepo / multi-service:** When multiple Node services are present, each is assigned a sequential debug port starting from the base port defined in the project type's Runtime Wiring table. See [multi-service.md](../multi-service.md) for port assignment rules.

---

## Variant Detection

| Signal | Variant | Notes |
|--------|---------|-------|
| `tsconfig.json` present | **node-ts** | TypeScript — requires compile step |
| `package.json` without `tsconfig.json` | **node-js** | Plain JavaScript — no compile step |

---

## Build Chain

Tasks owned by this runtime: install, clean, build, watch. The startup task and its dependency wiring are provided by the project type's Runtime Wiring table — not this file.

> **Task label scoping:** All task labels MUST be prefixed with the service ID (e.g., `functions-api: npm watch`). See [generate.md § Service ID Derivation](../generate.md).

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
| install | `{service-id}: npm install` | `npm install` | Installs dependencies | No |
| clean | `{service-id}: npm clean` | `npm run clean` | Cleans build output | No |
| watch | `{service-id}: npm watch` | `npm run watch` | Runs `tsc --watch` for incremental builds | ✅ Yes |
| build | `{service-id}: npm build` | `npm run build` | One-shot build (used outside debug flow) | No |

#### node-js (JavaScript)

```
"{service-id}: {startup task}"              ← from project-types/{type}.md Runtime Wiring
       ├── dependsOn: "{service-id}: npm install"
       └── dependsOn: "Start Emulators"     ← only when emulators are required
```

| Step | Task Label | Command | Purpose | Background? |
|------|-----------|---------|---------|------------|
| install | `{service-id}: npm install` | `npm install` | Installs dependencies | No |

> No compile, clean, or watch step — JavaScript runs directly.

> **Monorepo / alternative package managers:** Adjust commands if the project uses `yarn`, `pnpm`, or a monorepo layout. The key invariant is the chain shape: **install → [clean → build/watch →] startup task** (compile steps only for TypeScript).

See [generate.md](../generate.md) § Task `runOptions` Rules for how these build steps are rendered into VS Code task configuration.


---

## Convenience Scripts

The plan's Convenience Scripts table specifies WHICH scripts to generate. This section covers HOW to register them for Node.js projects.

**Script runner:** `package.json` `"scripts"` block
**Run command pattern:** `npm run {script-name}`

### Script Format

Each script is a shell command added to `package.json` `"scripts"`. Example entry:

```json
{
  "{script-name}": "{shell command}"
}
```

### Common Script Implementations

Use these implementations when building scripts from the plan:

| Script Purpose | Typical Command | Notes |
|---------------|-----------------|-------|
| Start emulators | `docker compose up -d` | Idempotent — safe to re-run |
| Stop emulators | `docker compose down` | Stops and removes containers |
| Clean emulator data | `docker compose down && npx rimraf {data-dirs}` | `{data-dirs}` = space-separated `./.{name}` directories derived from `docker-compose.yml` `volumes:` mounts (e.g., `.azurite .postgres`). Use `rimraf` (or `npx rimraf`) for cross-platform compatibility instead of `rm -rf`. |
| Run migrations | `{migration tool CLI command}` | See [migrations.md](../migrations.md) for how to determine the command |

---

## VS Code Extension Recommendations (`.vscode/extensions.json`)

No recommended extensions.

---

## VS Code Workspace Settings (`.vscode/settings.json`)

<!-- Settings contributed by this runtime. Aggregated with project-type settings into .vscode/settings.json by generate.md. -->

| Setting | Value | Why |
|---------|-------|-----|
| `files.exclude: **/node_modules` | `true` | Hide dependency tree from explorer — large and noisy |

> This exclusion reduces workspace noise. It is deep-merged with any existing `files.exclude` entries — see [generate.md § VS Code Workspace Settings](../generate.md).

---

## Checklist — Node.js Runtime Validation

After generating VS Code configuration, verify the following were produced correctly:

1. ✅ `launch.json` uses `"type": "node"` with the correct debug port
2. ✅ For TypeScript: `launch.json` includes `"outFiles"` derived from `tsconfig.json` `outDir` (e.g., `["${workspaceFolder}/{service-root}/{outDir}/**/*.js"]`)
3. ✅ For TypeScript: `tsconfig.json` has `"sourceMap": true` so `.js.map` files are generated
4. ✅ For TypeScript: watch task exists in `tasks.json` with `$tsc-watch` problem matcher
5. ✅ For TypeScript: build chain follows install → clean → watch dependency order

> Project-type-specific checks (e.g., `func: host start` task, connection strings) are defined in `project-types/{type}.md`.