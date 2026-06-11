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

VS Code compound launch configurations always start their listed configurations **in parallel**. There is no `dependsOrder` property for compounds — only individual tasks support sequenced dependencies. This means you cannot directly tell a compound to "start the backend before the frontend."

When a frontend service proxies to a local backend (e.g., a dev server proxy for API calls), the backend must be ready before the frontend starts. Otherwise the frontend proxy may produce `ECONNREFUSED` errors on startup. Since compounds cannot enforce this ordering, the workaround is to push the sequencing into a **compound task** that uses `dependsOrder: "sequence"`, and set that task as the compound's `preLaunchTask`.

> The plan may include a note like "ℹ️ **Proxy detected:**" indicating this dependency. Check the frontend's config files (e.g., `vite.config.ts` `server.proxy`) to confirm.

#### Pattern

**1. Generate a sequenced compound task** that starts services in order:

```json
{
  "label": "Start All Services",
  "dependsOn": [
    "{backend-service-id}: {backend-top-level-task}",
    "{frontend-service-id}: {frontend-top-level-task}"
  ],
  "dependsOrder": "sequence"
}
```

The backend is listed first. Its `problemMatcher` (from `project-types/{type}.md`) signals "ready" before the frontend task starts.

**2. Set the compound config's `preLaunchTask`** to the sequenced task:

```json
{
  "name": "{Launch Config Name from plan's compound row}",
  "configurations": ["{Backend Launch Config Name}", "{Frontend Launch Config Name}"],
  "preLaunchTask": "Start All Services",
  "stopAll": true
}
```

**3. Individual configs keep their own `preLaunchTask`** so they work standalone:

```json
{
  "name": "{Backend Launch Config Name}",
  "preLaunchTask": "{backend-service-id}: {backend-top-level-task}"
}
```

```json
{
  "name": "{Frontend Launch Config Name}",
  "preLaunchTask": "{frontend-service-id}: {frontend-top-level-task}"
}
```

**4. Set `instanceLimit: 1` and `instancePolicy: "silent"` on background tasks** to prevent duplicate instances.

When the compound runs, "Start All Services" starts both services via `dependsOrder: "sequence"`. Then each individual configuration's `preLaunchTask` fires again — but those services are already running. With `instanceLimit: 1` and `instancePolicy: "silent"`, the duplicate invocation is silently skipped and the existing instance keeps running.

#### Why This Pattern Is Necessary

| Concern | How it's solved |
|---------|----------------|
| Compounds can't sequence configurations | The sequenced compound **task** (`dependsOrder: "sequence"`) handles ordering instead |
| Backend must be ready before frontend starts | Backend is listed first in `dependsOn`; its problem matcher signals readiness |
| Debuggers must not attach before services are running | The compound's `preLaunchTask` ensures all services are started before any debugger attaches |
| Individual configs must still work standalone | Each config has its own `preLaunchTask` pointing to its service's top-level task |
| Duplicate task invocations from compound + individual preLaunchTasks | `instanceLimit: 1` + `instancePolicy: "silent"` silently skips the duplicate — the first instance keeps running |
