# Artifact Generation

Cross-cutting rules, step sequence, and assembly protocols for generating local development configuration files from an approved plan.

---

## Reading the Plan

The plan's tables drive all generation:

| Plan Section | What It Drives |
|-------------|----------------|
| **Services** table | Which services get launch.json/tasks.json entries. |
| **Emulators** table | Which emulator docker-compose services to generate. |
| **Orchestrator** table | Which orchestrator to use (e.g., Docker Compose) |
| **Migrations** table | Which migration docker-compose services to generate. |
| **API Test Collections** table | Which API test scripts to generate. |
| **Convenience Scripts** table | Which convenience scripts to generate. |

### Targeted Resolution

The plan provides high-level intent. For implementation details, perform **targeted resolution scans** of the workspace:

- **Migration details** — Scan for migration directory path, existing migration scripts, connection env var names. See [migrations.md](migrations.md).
- **API endpoints** — Parse function definitions or route handlers to get specific endpoint names, methods, routes, auth levels.
- **Connection string keys** — Check `local.settings.json`, `.env`, or app config for existing key names.
- **Existing config** — Check for existing `.vscode/launch.json`, `.vscode/tasks.json`, `docker-compose.yml` to determine merge vs create.
- **Framework details** — For frontend SPAs, detect the specific framework (Vite, Next.js, Angular, CRA) and dev server port from config files.
- **TypeScript source maps** — For TypeScript services, verify `tsconfig.json` has `"sourceMap": true` in `compilerOptions`. Without it, breakpoints in `.ts` files appear as unverified. See `runtimes/node.md` § Debugger Properties.

---

## Generation Steps

For each service in the plan's Services table (where Generate is checked), generate the following artifacts in order. The plan specifies WHAT to generate; the reference files linked below specify HOW.

| # | Action | Reference |
|---|--------|-----------|
| 1 | **Generate docker-compose** — For each emulator in the plan's Emulators table, load the emulator reference and assemble the docker-compose service block. If migrations are checked, add healthcheck and migration service. | [emulators/](emulators/), [migrations.md](migrations.md) |
| 2 | **Generate VS Code debug config** — Assemble `launch.json` and `tasks.json` entries from the project-type and runtime references. For multi-service workspaces, generate compound configuration. | generate.md § Source Ownership, [project-types/](project-types/), [runtimes/](runtimes/), [multi-service.md](multi-service.md) |
| 3 | **Generate VS Code workspace config** — Assemble `.vscode/extensions.json` and `.vscode/settings.json` from project-type and runtime references. Add emulator data directory exclusions. | generate.md § VS Code Extension Recommendations, generate.md § VS Code Workspace Settings |
| 4 | **Configure connection strings** — Update `local.settings.json`, `.env`, or app config with emulator connection strings. Never overwrite existing values. | `project-types/{type}.md` § Connection Strings, `emulators/{name}.md` § Required App Environment Variables |
| 5 | **Generate convenience scripts** — For each checked script in the plan's Convenience Scripts table, add to the project's native script runner. | `runtimes/{rt}.md` § Convenience Scripts |
| 6 | **Generate migrations** — If the plan's Migrations table has checked rows, do targeted resolution for migration details, then generate the docker-compose migration service. | [migrations.md](migrations.md) |
| 7 | **Generate API test collections** — If the plan's API Test Collections table has checked rows, do targeted resolution for endpoints/triggers, then generate test scripts. | [api-test-collections.md](api-test-collections.md) |

---

## Dependency Availability

> ⚠️ **Do not assume CLI tools or packages are installed in the target project.**

Before writing any script or task command that invokes a CLI tool (e.g., `rimraf`, `concurrently`, `cross-env`):

1. **Check** — Verify the tool is already a project dependency.
2. **Add dependency** — Add it as a project dev dependency. This ensures it is version-locked and works consistently across all machines.
3. **Ask if uncertain** — Use `ask_user` if the tool is expensive, opinionated, or has multiple alternatives.

---

## VS Code Debug & Task Configuration

Assemble `.vscode/launch.json` and `.vscode/tasks.json` by combining properties from the detected **project type** and **runtime** references. Use the source ownership table below to determine which file provides each property.

### Source Ownership

| Concern | Server-side project source | Browser SPA source |
|---------|---------------------------|-------------------|
| Debugger type (`node`, `coreclr`) | `runtimes/{rt}.md` § Debugger Properties | `project-types/frontend-spa/debug-adapters/{adapter}.md` |
| Debug port | `runtimes/{rt}.md` § Debugger Properties | N/A (uses dev server URL) |
| Request mode (`attach` / `launch`) | `project-types/{type}.md` § Runtime Wiring | `project-types/frontend-spa/frontend-spa.md` § Runtime Wiring |
| Top-level startup task (type, command, problem matcher) | `project-types/{type}.md` § VS Code Task Configuration | `project-types/frontend-spa/frontend-spa.md` § VS Code Task Configuration |
| Build chain tasks (install, clean, watch) | `runtimes/{rt}.md` § Build Chain | N/A (dev server handles compilation) |
| Runtime-specific launch properties (`outFiles`, `processName`) | `runtimes/{rt}.md` § Debugger Properties | N/A |
| Compound configuration | [multi-service.md](multi-service.md) § Compound Debug Configuration | [multi-service.md](multi-service.md) § Compound Debug Configuration |
| Working directory (`cwd`) rules | generate.md § Working Directory (`cwd`) Rules | generate.md § Working Directory (`cwd`) Rules |
| Task `runOptions` rules | generate.md § Task `runOptions` Rules | generate.md § Task `runOptions` Rules |
| Emulator startup task (`Start Emulators`) | `runtimes/{rt}.md` § Build Chain | N/A (backend service owns emulators) |

> `project-types/{type}.md` § VS Code Task Configuration provides **concrete task JSON per runtime** — use those blocks directly. `runtimes/{rt}.md` § Build Chain provides the dependency tasks that the startup task's `dependsOn` references.

### Service ID Derivation

Derive a canonical service ID from the plan's **Service Label** column: lowercase, kebab-case (e.g., "Functions API" → `functions-api`, "Web App" → `web-app`). This ID is used for:

- Task labels (e.g., `functions-api: func host start`)
- Launch config naming (use the plan's **Launch Config Name** column directly)
- Compound config member references

If two services resolve to the same ID, append the project type: `payments-api-functions`.

> ⛔ Every generated task label should conform to `{service-id}: {task name}` (e.g., `functions-api: func host start`, `functions-api: dotnet build`). Wherever a task label is referenced — generation blocks, `dependsOn` chains, `preLaunchTask` values, validation Ready-Signal tables, and validation checklists — it **MUST** use this `{service-id}:` form. Instruction files and any examples that show a label without the `{service-id}:` prefix added are illustrating the latter part of the label; resolve it to the full form before writing or matching.

### Task Chain Shape (Server-side only)

> Browser-based projects (e.g., Frontend SPA) skip the build chain — the dev server task is the only task. See `project-types/{type}.md` § VS Code Task Configuration.

```
"{service-id}: {top-level-task}"         ← project-type-specific (see project-types/{type}.md)
       ├── dependsOn: "{service-id}: {watch-task}"    ← from runtimes/{rt}.md
       │                └── dependsOn: "{service-id}: {clean-task}"
       │                               └── dependsOn: "{service-id}: {install-task}"
       └── dependsOn: "Start Emulators"               ← only when emulators are required
```

> Adjust task labels and commands for alternative package managers (`yarn`, `pnpm`, `gradle`). The key invariant is the chain shape: **install → clean → build/watch → top-level task** (with `Start Emulators` as a sibling dependency of the top-level task, NOT nested under install). Some runtimes skip steps — use only what applies.

### Project Type Path Resolution

Most project types have a single reference file at `project-types/{type}.md`. Some use a subdirectory:

| Project Type | Reference Path |
|--------------|---------------|
| `functions` | `project-types/functions.md` |
| `frontend-spa` | `project-types/frontend-spa/frontend-spa.md` |

When instructions reference `project-types/{type}.md`, resolve via this table. If the type is not listed, look for `project-types/{type}.md` first, then `project-types/{type}/{type}.md`.

### Working Directory (`cwd`) Rules

> ⚠️ **CRITICAL for multi-service repos.** Without correct `cwd`, commands like `npm install` or `func host start` will run from the workspace root and fail.

Use the **Service Root** column from the plan's Services table to determine the `cwd` for each task.

| Task Scope | `cwd` Setting | Example |
|------------|--------------|---------|
| **Per-service tasks** (install, clean, watch, build, top-level) | `"options": { "cwd": "${workspaceFolder}/{service-root}" }` | `"cwd": "${workspaceFolder}/api"` |
| **Shared tasks** (Start Emulators) | Workspace root (omit `cwd` — it defaults to workspace root) | — |
| **Single-service repos** | Omit `cwd` — workspace root is the service root | — |

### Task `runOptions` Rules

Every task generated for the debug chain (install, clean, watch, build, top-level, and emulator tasks) **must** include `runOptions` with `instanceLimit: 1` and `instancePolicy: "silent"`. This prevents duplicate task instances and silently skips re-invocations when a task is already running (e.g., from compound + individual `preLaunchTask` chains).

### Start Emulators Task

When the plan includes emulators, generate a shared `Start Emulators` task. This task is a **sibling dependency** of each service's top-level startup task (e.g., `func host start`). Do NOT place `Start Emulators` as a dependency of build chain tasks like `npm install` or `npm watch` — it belongs in the startup task's `dependsOn` array alongside the build chain prerequisite.

```json
{
  "type": "shell",
  "label": "Start Emulators",
  "command": "docker compose up -d",
  "problemMatcher": [],
  "runOptions": { "instanceLimit": 1, "instancePolicy": "silent" }
}
```

### instanceLimit and instancePolicy

Set **`instanceLimit: 1`** and **`instancePolicy: "silent"`** on every task. You never want parallel instances of the same build or startup task, and `"silent"` ensures that duplicate invocations are skipped without prompting the user.

### Problem Matchers

**Background tasks (`isBackground: true`) MUST have a real `problemMatcher`.** An empty matcher (`"problemMatcher": []`) on a background task causes a blocking VS Code dialog ("This task is tracked by a problem matcher"). Look up the correct matcher from the relevant reference file:

- **Runtime tasks** (build, watch) → `runtimes/{rt}.md` § VS Code Problem Matchers
- **Project-type tasks** (top-level startup) → `project-types/{type}.md` § VS Code Task Configuration
- **Frontend dev servers** → `project-types/frontend-spa/frontend-spa.md` § Framework Lookup Table

For non-background tasks:

| Task Type | Matcher |
|-----------|---------|
| Short-lived commands (`npm install`, `npm clean`, `docker compose up -d`) | `"problemMatcher": []` |
| Dependency-only tasks (only `dependsOn`, no `command`) | Omit `problemMatcher` entirely |

Short-lived commands use an empty matcher to suppress matching on tasks that don't produce compiler-style output.

### Example

```json
{
  "type": "shell",
  "label": "npm install",
  "command": "npm install",
  "runOptions": { "instanceLimit": 1, "instancePolicy": "silent" },
  "problemMatcher": []
}
```

---

## VS Code Extension Recommendations (`.vscode/extensions.json`)

Aggregate extension recommendations from the detected **runtime** and **project type** into `.vscode/extensions.json`. Each source lists its required extensions in a `## VS Code Extension Recommendations` section with an `Extension ID | Why Required` table.

### Assembly Protocol

| Step | Action | Details |
|------|--------|---------|
| 1. Collect | Gather from runtime | Read extension IDs from `runtimes/{rt}.md § VS Code Extension Recommendations` |
| 2. Collect | Gather from project type | Read extension IDs from `project-types/{type}.md § VS Code Extension Recommendations` |
| 3. Deduplicate | Remove duplicates | Each extension ID appears once in the final list |
| 4. Write | Output `.vscode/extensions.json` | Contribute to the file — do not replace existing entries |

### Output Format

```json
{
  "recommendations": [
    "{runtime-extension-1}",
    "{project-type-extension-1}"
  ]
}
```

---

## VS Code Workspace Settings (`.vscode/settings.json`)

Aggregate workspace settings from the detected **runtime**, **project type**, and **emulator configuration** into `.vscode/settings.json`. Each source lists its contributed settings in a `## VS Code Workspace Settings` section with a `Setting | Value | Why` table.

### Assembly Protocol

| Step | Action | Details |
|------|--------|---------|
| 1. Collect | Gather from runtime | Read settings from `runtimes/{rt}.md § VS Code Workspace Settings` |
| 2. Collect | Gather from project type | Read settings from `project-types/{type}.md § VS Code Workspace Settings` |
| 3. Collect | Gather emulator exclusions | Derive data directory exclusions from `docker-compose.yml` `volumes:` mounts |
| 4. Write | Output `.vscode/settings.json` | Contribute to the file — do not replace existing entries or user customizations |

### Emulator Data Directory Exclusions

When emulators are configured via docker-compose, add their data directories to both `files.exclude` and `search.exclude` in **`.vscode/settings.json`** to reduce workspace noise:

```json
{
  "files.exclude": {
    "**/.azurite": true,
    "**/.postgres": true
  },
  "search.exclude": {
    "**/.azurite": true,
    "**/.postgres": true
  }
}
```

> Derive directory names from the actual `volumes:` mounts in `docker-compose.yml` — do not hardcode. Each emulator's data directory pattern is defined in `emulators/{name}.md`.
