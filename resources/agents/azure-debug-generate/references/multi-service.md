# Multi-Service Orchestration — Generation

> Applies when the plan's Services table has **2+ rows** (excluding the compound config row). Governs compound debug configuration, working directory rules, startup ordering, and partial configuration handling.

---

## Port Assignment

When two or more services share the same runtime, each needs a unique debug port. Look up the `Base debug port` from `runtimes/{rt}.md` and assign ports sequentially: first service gets the base port, second gets base + 1, third gets base + 2, etc.

> Browser-based project types (e.g., Frontend SPA) do not use debug ports — they connect via the dev server URL instead.

---

## Partial Configuration Handling

Check each service root for existing VS Code debug config before generating anything. A service is considered already configured if it has an existing debug configuration entry in `.vscode/launch.json` matching its service ID or Launch Config Name.

| State | Action |
|-------|--------|
| **Fully configured service** | Skip all artifact generation for that service; carry its existing config into the compound configuration unchanged |
| **Partially configured service** | Generate only what is missing (e.g. tasks but no debug config → generate debug config only) |
| **Unconfigured service** | Generate all artifacts as normal |

Adding a second service to an existing single-service repo is safe — the original service's config is preserved and the new service is added alongside it.

---

## Compound Debug Configuration

> ⛔ **MANDATORY:** When 2+ service roots are detected (including Frontend SPA projects), a compound debug configuration **must** be generated. A frontend SPA counts as a service root — it does not need emulators, but it does need a debug config entry and inclusion in the compound.

> ⚠️ **Working directory:** Multi-service task chains require correct `cwd` on every per-service task. See [generate.md § Working Directory (`cwd`) Rules](generate.md) — without it, commands like `npm install` or `func host start` run from the workspace root and fail.

Use the plan's Services table to assemble the compound config. The compound config row in the plan specifies the Launch Config Name (e.g., "Debug All Services").

### Startup Ordering

VS Code compound launch configurations always start their listed configurations **in parallel** — there is no `dependsOrder` for compounds. The only sequencing mechanism available is the compound's `preLaunchTask`.

When a frontend SPA has a proxy configuration pointing to a local backend service, the backend must be ready before the frontend dev server starts (otherwise the frontend proxy produces `ECONNREFUSED` errors). Use the following pattern:

> The plan may include a note like "ℹ️ **Proxy detected:**" indicating this dependency. Check the frontend's config files (e.g., `vite.config.ts` `server.proxy`) to confirm.

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

The backend task is listed first, so its `problemMatcher` (e.g., `$func-node-watch`) must signal "ready" before the frontend dev server starts.

**2. Set the compound launch config's `preLaunchTask`** to this sequenced task:

```json
{
  "name": "{Launch Config Name from plan's compound row}",
  "configurations": ["{Launch Config Name 1}", "{Launch Config Name 2}", "..."],
  "preLaunchTask": "Start All Services",
  "stopAll": true
}
```

**3. Individual configs keep their own `preLaunchTask`** pointing to their service's top-level task (so they work standalone):

```json
{
  "name": "{Launch Config Name 1}",
  "type": "node",
  "request": "attach",
  "port": 9229,
  "preLaunchTask": "{backend-service-id}: {top-level-task}"
}
```

```json
{
  "name": "{Launch Config Name 2}",
  "type": "chrome",
  "request": "launch",
  "url": "http://localhost:{port}",
  "webRoot": "${workspaceFolder}/{service-root}",
  "preLaunchTask": "{frontend-service-id}: dev server"
}
```

**4. Use `instancePolicy: "silent"` on port-binding background tasks** to prevent double-invocation:

When the compound runs, "Start All Services" starts both services. Then each configuration's `preLaunchTask` fires — but since `instanceLimit: 1` and `instancePolicy: "silent"`, the duplicate is silently skipped.

### Why This Works

- `dependsOrder: "sequence"` on the compound task ensures backend is ready (problem matcher signals) before frontend starts
- `preLaunchTask` on the compound ensures both services are running before debuggers attach
- `instancePolicy: "silent"` prevents the individual configs' preLaunchTasks from killing/restarting services already started by the compound task
- Individual configs still work standalone (when no instance is running, the task starts normally)
