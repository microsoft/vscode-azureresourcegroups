# Multi-Service Orchestration — Generation

> Applies when plan Services table has **2+ rows**, excluding compound config row. Governs compound debug configuration, working directories, startup ordering, and partial configurations.

---

## Port Assignment

Services sharing runtime need unique debug ports. From `runtimes/{rt}.md` `Base debug port`, assign sequentially: base, base + 1, base + 2, etc.

> Browser project types (e.g., Frontend SPA) use dev server URL, not debug ports.

---

## Partial Configuration Handling

Before generation, check each service root for VS Code debug config. Existing `.vscode/launch.json` entry matching service ID or Launch Config Name means configured.

| State | Action |
|-------|--------|
| **Fully configured service** | Skip its artifact generation; carry existing config unchanged into compound |
| **Partially configured service** | Generate only missing parts (e.g. tasks but no debug config → debug config only) |
| **Unconfigured service** | Generate all artifacts as normal |

Adding second service to existing single-service repo preserves original config and adds new service beside it.

---

## Compound Debug Configuration

> ⛔ **MANDATORY:** With 2+ service roots, including Frontend SPA, generate compound debug configuration. Frontend SPA counts: no emulator needed, but requires debug entry and compound membership.

> ⚠️ **Working directory:** Every multi-service per-service task needs correct `cwd`. See [generate.md § Working Directory (`cwd`) Rules](generate.md). Otherwise `npm install` or `func host start` runs from workspace root and fails.

Assemble compound from plan Services table. Compound row supplies Launch Config Name (e.g., "Debug All Services").

### Startup Ordering

VS Code compounds start listed configs **in parallel**. Compounds lack `dependsOrder`; only tasks sequence dependencies. Thus compound cannot directly start backend before frontend.

When frontend proxies local backend (e.g., API dev-server proxy), backend must become ready first or proxy may emit `ECONNREFUSED`. Since compounds cannot order, sequence through **compound task** using `dependsOrder: "sequence"`; set it as compound `preLaunchTask`.

> Plan may say "ℹ️ **Proxy detected:**". Confirm in frontend config (e.g., `vite.config.ts` `server.proxy`).

#### Pattern

**1. Generate sequenced compound task** starting services in order. Use descriptive label, below `{sequenced-compound-task}`:

```json
{
  "label": "{sequenced-compound-task}",
  "dependsOn": [
    "{backend-service-id}: {backend-top-level-task}",
    "{frontend-service-id}: {frontend-top-level-task}"
  ],
  "dependsOrder": "sequence",
  "runOptions": { "instanceLimit": 1, "instancePolicy": "silent" }
}
```

List backend first. Its `problemMatcher` from `project-types/{type}.md` signals ready before frontend starts.

**2. Set compound `preLaunchTask`** to sequenced task:

```json
{
  "name": "{Launch Config Name from plan's compound row}",
  "configurations": ["{Backend Launch Config Name}", "{Frontend Launch Config Name}"],
  "preLaunchTask": "{sequenced-compound-task}",
  "stopAll": true
}
```

**3. Keep each config's `preLaunchTask`** for standalone use:

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

**4. On background tasks, set `instanceLimit: 1` and `instancePolicy: "silent"`** to prevent duplicates.

Compound task starts both services via `dependsOrder: "sequence"`. Individual `preLaunchTask` then fires again against running services. `instanceLimit: 1` + `instancePolicy: "silent"` skips duplicates while existing instances continue.

#### Why This Pattern Is Necessary

| Concern | How it's solved |
|---------|----------------|
| Compounds can't sequence configurations | Sequenced compound **task** (`dependsOrder: "sequence"`) owns ordering |
| Backend must be ready before frontend starts | Backend first in `dependsOn`; problem matcher signals readiness |
| Debuggers must not attach before services are running | Compound `preLaunchTask` starts all services before debugger attachment |
| Individual configs must still work standalone | Each config `preLaunchTask` points to service top-level task |
| Duplicate task invocations from compound + individual preLaunchTasks | `instanceLimit: 1` + `instancePolicy: "silent"` skips duplicate; first continues |

---

### Deduplicated Startup Graph

Every generated compound MUST satisfy **all** rules, checkable in `tasks.json` / `launch.json`:

| # | Rule | How to check |
|---|------|--------------|
| 1 | **Each service top-level task appears once** in compound effective task graph (transitive `dependsOn` closure of sequenced compound task). No start task reachable by two paths. | Expand sequenced compound task `dependsOn` closure; each service top-level label occurs once. |
| 2 | **Sequenced compound task solely owns startup ordering.** No per-service task redeclares `dependsOn` another service start; ordering exists only in sequenced compound task. | No service start task has another service start task in `dependsOn`. |
| 3 | **Every background task sets `instanceLimit: 1` and `instancePolicy: "silent"`.** | Every long-running chain task has both. |

Because individual configs retain `preLaunchTask` for standalone use, compound invokes each start task twice. Rule 3 makes second invocation silent no-op; Rules 1–2 prevent first-pass double starts.
