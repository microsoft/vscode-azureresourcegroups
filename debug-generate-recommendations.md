# Debug Generate Agent — Recommended Instruction Updates

Based on a full end-to-end test of the `azure-debug-generate` agent, the following issues were encountered and resolved. These recommendations should be incorporated into the instruction set to prevent future occurrences.

---

## 1. Compound Launch Configuration Pattern (CRITICAL)

### Problem

The current instructions in `multi-service.md` state:

> The compound configuration itself must **not** reference the "Start Emulators" task directly (e.g., via `preLaunchTask`). Emulator startup is owned by each service's task chain via `dependsOn`. Adding it to the compound causes double execution.

And for startup ordering:

> the frontend's dev server task should depend on the backend's top-level task

This creates a problem: adding `dependsOn: ["{backend-top-level-task}"]` to the frontend dev server task means launching the frontend config standalone **also** starts the entire backend chain. The frontend and compound configs become functionally identical (except the compound also attaches the Node debugger).

### Root Cause

VS Code compound launch configurations always start their listed configurations **in parallel**. There is no `dependsOrder` for compounds. The only sequencing mechanism available is the compound's `preLaunchTask`.

### Recommended Fix

Replace the current compound guidance with this pattern:

**1. Generate a "Start All Services" compound task** with `dependsOrder: "sequence"`:

```json
{
  "label": "Start All Services",
  "dependsOn": [
    "{backend-service-id}: {top-level-task}",
    "{frontend-service-id}: dev server"
  ],
  "dependsOrder": "sequence",
  "problemMatcher": []
}
```

The backend task is listed first, so its `problemMatcher` (e.g., `$func-node-watch`) must signal "ready" before the frontend dev server starts. This eliminates `ECONNREFUSED` errors from the frontend proxy.

**2. Set the compound launch config's `preLaunchTask`** to this sequenced task:

```json
{
  "name": "Debug All Services",
  "configurations": ["Attach to API", "Attach to Web"],
  "preLaunchTask": "Start All Services",
  "stopAll": true
}
```

**3. Individual configs keep their own `preLaunchTask`** pointing to their service's top-level task (so they work standalone):

```json
{
  "name": "Attach to API",
  "type": "node",
  "request": "attach",
  "port": 9229,
  "preLaunchTask": "{backend-service-id}: {top-level-task}"
},
{
  "name": "Attach to Web",
  "type": "chrome",
  "request": "launch",
  "url": "http://localhost:{port}",
  "webRoot": "${workspaceFolder}/{service-root}",
  "preLaunchTask": "{frontend-service-id}: dev server"
}
```

**4. Use `instancePolicy: "silent"` on port-binding background tasks** to prevent double-invocation:

When "Debug All Services" runs, "Start All Services" starts both services. Then each configuration's `preLaunchTask` fires — but since `instanceLimit: 1` and `instancePolicy: "silent"`, the duplicate is silently skipped.

### Why this works

- `dependsOrder: "sequence"` on the compound task ensures backend is ready (problem matcher signals) before frontend starts
- `preLaunchTask` on the compound ensures both services are running before debuggers attach
- `instancePolicy: "silent"` prevents the individual configs' preLaunchTasks from killing/restarting services already started by the compound task
- Individual configs still work standalone (when no instance is running, the task starts normally)

---

## 2. instancePolicy Rule Change (CRITICAL)

### Problem

The current rule states:

> Task binds a network port → `"terminateOldest"`

This conflicts with the compound pattern above. When the compound's "Start All Services" starts func, then the "Attach to API" config's `preLaunchTask` fires, `terminateOldest` kills the running func process — defeating the sequenced startup.

### Recommended Fix

Update the `instancePolicy` rules to:

1. **Task binds a network port AND is used in a multi-service compound with a sequenced preLaunchTask** → **`"silent"`**. The compound task handles startup ordering; duplicates must be silently skipped. Watch-mode processes (func with tsc --watch, Vite HMR) keep the existing instance valid.
2. **Task binds a network port AND is NOT in a compound setup (single-service)** → **`"terminateOldest"`**. No risk of double-invocation; stale port recovery matters.
3. **Task requires a full restart to pick up changes** (e.g., .NET `dotnet build`) → **`"terminateOldest"`**.
4. **Task auto-reloads on file changes and does NOT bind a port** (e.g., `tsc --watch`) → **`"silent"`**.
5. **Task is idempotent** (e.g., `npm install`, `docker compose up -d`) → **`"silent"`**.

**In practice**: for multi-service repos (the common case for this agent), all background tasks should use `"silent"`.

---

## 3. sourceMap Must Be Enabled (HIGH)

### Problem

The generated `tsconfig.json` for the functions project did not include `"sourceMap": true`. The Node debugger attached successfully (port 9229 was connected) but breakpoints showed as "unverified" because VS Code couldn't map compiled JS to TypeScript source.

### Recommended Fix

Add to the generation instructions (likely in `runtimes/node.md` or the tsconfig generation step):

> When generating or verifying `tsconfig.json` for a TypeScript service that will be debugged, ensure `"sourceMap": true` is present in `compilerOptions`. Without source maps, the debugger cannot resolve breakpoints in `.ts` files even when successfully attached.

Add to the validation checklist:

> ✅ `tsconfig.json` includes `"sourceMap": true` in `compilerOptions`

---

## 4. webRoot Resolution for All Frontend Frameworks (HIGH)

### Problem

The Chromium debug adapter reference (`debug-adapters/chromium.md`) specifies:

```json
"webRoot": "${workspaceFolder}/{service-root}"
```

For a Vite project at `src/web/` with source files in `src/web/src/`, the agent set `webRoot` to `${workspaceFolder}/src/web/src`. But Vite's root is `src/web/` (where `vite.config.ts` lives), and it serves files with paths like `/src/pages/Dashboard.tsx`. Chrome maps these to `webRoot + /src/pages/Dashboard.tsx`.

With `webRoot = src/web/src`, the resolved path becomes `src/web/src/src/pages/Dashboard.tsx` (doubled `src`).

This is **not Vite-specific** — it affects any framework where the config file lives in a parent directory of `src/`. CRA, Angular, and Next.js all commonly have a `src/` subdirectory. The bug pattern is universal:

1. Framework root = directory containing the config file (e.g., `vite.config.ts`, `package.json` for CRA, `angular.json`, `next.config.js`)
2. Source code lives in `{framework-root}/src/`
3. Dev server serves files relative to the framework root — paths look like `/src/App.tsx`
4. Chrome resolves breakpoints as `{webRoot}/src/App.tsx`
5. If `webRoot` is set to the `src/` subdirectory instead of the framework root, paths double to `{service-root}/src/src/App.tsx`

### Recommended Fix

Replace the current `webRoot` guidance in `debug-adapters/chromium.md` with a general rule:

> **Universal rule:** `webRoot` must ALWAYS be the **framework root directory** (where the framework's config file lives), NEVER a subdirectory within it. The dev server determines its URL path structure relative to this root. Setting `webRoot` to a subdirectory like `src/` causes path doubling and breaks breakpoint resolution.

| Framework | Config file that defines the root | `webRoot` value |
|-----------|----------------------------------|-----------------|
| Vite | `vite.config.*` | Directory containing `vite.config.*` |
| CRA | `package.json` (with `react-scripts`) | Directory containing `package.json` |
| Angular | `angular.json` | Workspace root (or project root in monorepo) |
| Next.js | `next.config.*` | Directory containing `next.config.*` |
| Blazor WASM | `*.csproj` | Directory containing `*.csproj` |

The existing `chromium.md` template uses `${workspaceFolder}/{service-root}` — this is correct **only if `service-root` points to the framework config directory**. Add an explicit validation:

> ⛔ Before writing `webRoot`, verify: does `{service-root}` contain the framework config file (e.g., `vite.config.ts`, `angular.json`)? If the plan's Service Root points to a `src/` subdirectory that does NOT contain the config file, walk up to the parent that does.

---

## Summary of File Changes Needed

| File | Change |
|------|--------|
| `references/multi-service.md` | Replace compound guidance with "Start All Services" compound task pattern; remove warning against `preLaunchTask` on compounds |
| `references/generate.md` § instancePolicy | Update rules for multi-service repos (silent for background port-binding tasks) |
| `references/generate.md` | Add sourceMap requirement for TypeScript services |
| `references/project-types/frontend-spa/debug-adapters/chromium.md` | Clarify webRoot = framework root, not src subdirectory |
