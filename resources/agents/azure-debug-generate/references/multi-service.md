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

Use the plan's Services table to assemble the compound config. The compound config row in the plan specifies the Launch Config Name (e.g., "Debug All Services").

```json
{
  "name": "{Launch Config Name from plan's compound row}",
  "configurations": ["{Launch Config Name 1}", "{Launch Config Name 2}", "..."],
  "stopAll": true
}
```

> ⚠️ The compound configuration itself must **not** reference the "Start Emulators" task directly (e.g., via `preLaunchTask`). Emulator startup is owned by each service's task chain via `dependsOn`. Adding it to the compound causes double execution.

> ⚠️ **Working directory:** Multi-service task chains require correct `cwd` on every per-service task. See [generate.md § Working Directory (`cwd`) Rules](generate.md) — without it, commands like `npm install` or `func host start` run from the workspace root and fail.

### Startup Ordering

When a frontend SPA has a proxy configuration pointing to a local backend service, the backend service's startup task should complete its ready signal before the frontend dev server starts. Enforce this via `dependsOn` in the task chain — the frontend's dev server task should depend on the backend's top-level task.

> The plan may include a note like "ℹ️ **Proxy detected:**" indicating this dependency. Check the frontend's config files (e.g., `vite.config.ts` `server.proxy`) to confirm.
