# Artifact Generation

Cross-cutting rules, sequence, and assembly protocols for local development config from approved plan.

---

## Reading the Plan

Plan tables drive generation:

| Plan Section | What It Drives |
|-------------|----------------|
| **Services** table | Services receiving launch.json/tasks.json entries. |
| **Emulators** table | Emulator compose services to generate. |
| **Orchestrator** table | Container runtime (Docker/Podman) and **Compose Command** (`docker compose` / `podman compose`) for every emulator/migration task. |
| **Migrations** table | Migration compose services to generate. |
| **API Test Collections** table | API test scripts to generate. |
| **Convenience Scripts** table | Convenience scripts to generate. |

> **Container runtime is a plan value — never hard-code `docker compose`.** Read the **Compose Command** cell from the plan's Orchestrator table and use it verbatim for every generated Compose invocation (Start Emulators task, migration task, convenience scripts, validation, teardown). It is `docker compose` by default and `podman compose` when the plan selected Podman. The generated `docker-compose.yml` itself is **identical for either engine** — only the command that drives it changes. In the examples throughout these references, `docker compose` stands in for the plan's Compose Command; substitute `podman compose` when the plan says Podman.

### Targeted Resolution

Plan supplies high-level intent. Resolve implementation details through targeted workspace scans:

- **Migration details** — Find migration path, scripts, connection env var names. See [migrations.md](migrations.md).
- **API endpoints** — Parse function definitions/route handlers for names, methods, routes, auth.
- **Connection string keys** — Find existing names in `local.settings.json`, `.env`, or app config.
- **Existing config** — Inspect `.vscode/launch.json`, `.vscode/tasks.json`, `docker-compose.yml` for merge vs create.
- **Framework details** — For frontend SPAs, detect framework (Vite, Next.js, Angular, CRA) and dev-server port from config.
- **TypeScript source maps** — Require TypeScript `tsconfig.json` `"sourceMap": true` in `compilerOptions`; otherwise `.ts` breakpoints stay unverified. See `runtimes/node.md` § Debugger Properties.

---

## Generation Steps

For each checked Generate service in plan Services table, generate in order. Plan defines WHAT; references define HOW.

| # | Action | Reference |
|---|--------|-----------|
| 1 | **Generate docker-compose** — For each planned emulator, load reference and assemble service block. If migrations checked, add healthcheck + migration service. | [emulators/](emulators/), [migrations.md](migrations.md) |
| 2 | **Generate VS Code debug config** — Assemble `launch.json`/`tasks.json` from project-type + runtime references. Add compound for multi-service. | generate.md § Source Ownership, [project-types/](project-types/), [runtimes/](runtimes/), [multi-service.md](multi-service.md) |
| 3 | **Generate VS Code workspace config** — Assemble `.vscode/extensions.json`/`.vscode/settings.json` from project-type + runtime references. Add emulator data exclusions. | generate.md § VS Code Extension Recommendations, generate.md § VS Code Workspace Settings |
| 4 | **Configure connection strings** — Update `local.settings.json`, `.env`, or app config with emulator strings; preserve existing values. | `project-types/{type}.md` § Connection Strings, `emulators/{name}.md` § Required App Environment Variables |
| 5 | **Generate convenience scripts** — Add each checked Convenience Scripts row to native script runner. | `runtimes/{rt}.md` § Convenience Scripts |
| 6 | **Generate migrations** — For checked Migrations rows, resolve details then generate docker-compose migration service. | [migrations.md](migrations.md) |
| 7 | **Generate API test collections** — For checked API Test Collections rows, resolve endpoints/triggers then generate test scripts. | [api-test-collections.md](api-test-collections.md) |

> **Podman emulator certification.** When the plan's container runtime is **Podman**, each emulator's reference file declares its Podman status under `## Container Runtime Support`. Azurite and PostgreSQL are certified. For any emulator not marked Podman-certified, emit a `⚠️ LIMITED SUPPORT: Emulator "{name}" is not yet certified for Podman` warning (per [limited-support.md](limited-support.md)) and generate a best-effort compose service anyway — do **not** silently swap the runtime back to Docker.

---

## Dependency Availability

> ⚠️ **Never assume target project has CLI tools/packages installed.**

Before writing script/task invoking CLI (e.g., `rimraf`, `concurrently`, `cross-env`):

1. **Check** — Verify existing project dependency.
2. **Add dependency** — Add as project dev dependency for version lock + consistent machines.
3. **Ask if uncertain** — Use `ask_user` for expensive/opinionated tools or multiple alternatives.

---

## Local Credentials

> ⚠️ **Never inline literal credentials in task/compose files.** Declare once in workspace-root
> `.env`; reference everywhere through Compose `${VAR}` interpolation.

| Correct | Do **not** generate |
|---|---|
| Compose `${VAR}` interpolation from `.env` | A literal credential inlined into a task or compose file |

Secret-redaction filters rewrite concrete credential literals. Masked values beginning `*` fatally
break YAML: leading `*` means alias reference, stopping compose parsing.

Interpolation needs defined variable: Compose reads `${...}` from `.env` or shell, never service
`environment:`. If generated compose service, host task, or connection string references variable,
`.env` must declare it or value silently becomes empty.

> ⛔ **`.gitignore` must list `.env` before you create it.** Committed credentials are compromised
> and require rotation; later deletion leaves them in history, clones, and forks. Private
> repositories included. If `.gitignore` absent or omits `.env`, fix first.

Per-emulator variables: `emulators/{name}.md` § Required App Environment Variables.

---

## VS Code Debug & Task Configuration

Assemble `.vscode/launch.json` + `.vscode/tasks.json` from detected **project type** and **runtime** references. Ownership table identifies each property's source.

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

> `project-types/{type}.md` § VS Code Task Configuration provides **concrete runtime task JSON**; use directly. `runtimes/{rt}.md` § Build Chain provides startup `dependsOn` tasks.

### Service ID Derivation

Derive canonical service ID from plan **Service Label**: lowercase kebab-case (e.g., "Functions API" → `functions-api`, "Web App" → `web-app`). Use for:

- Task labels (e.g., `functions-api: func host start`)
- Launch naming (use plan **Launch Config Name** directly)
- Compound config member references

On duplicate IDs, append project type: `payments-api-functions`.

> ⛔ Every generated task label follows `{service-id}: {task name}` (e.g., `functions-api: func host start`, `functions-api: dotnet build`). Every reference—generation blocks, `dependsOn`, `preLaunchTask`, validation Ready-Signal tables/checklists—**MUST** use `{service-id}:`. Examples lacking `{service-id}:` prefix show label suffix only; resolve full form before write/match.

### Task Chain Shape (Server-side only)

> Browser projects (e.g., Frontend SPA) skip build chain; dev server is sole task. See `project-types/{type}.md` § VS Code Task Configuration.

```
"{service-id}: {top-level-task}"         ← project-type-specific (see project-types/{type}.md)
       ├── dependsOn: "{service-id}: {watch-task}"    ← from runtimes/{rt}.md
       │                └── dependsOn: "{service-id}: {clean-task}"
       │                               └── dependsOn: "{service-id}: {install-task}"
       └── dependsOn: "Start Emulators"               ← only when emulators are required
```

> Adjust labels/commands for `yarn`, `pnpm`, `gradle`. Preserve **install → clean → build/watch → top-level task**, with `Start Emulators` sibling of top-level—not under install. `Start Emulators` must not sit under install. Omit inapplicable runtime steps.

### Project Type Path Resolution

Most types use `project-types/{type}.md`; some use subdirectory:

| Project Type | Reference Path |
|--------------|---------------|
| `functions` | `project-types/functions.md` |
| `frontend-spa` | `project-types/frontend-spa/frontend-spa.md` |

Resolve `project-types/{type}.md` via table. For unlisted type, try `project-types/{type}.md`, then `project-types/{type}/{type}.md`.

### Working Directory (`cwd`) Rules

> ⚠️ **CRITICAL for multi-service repos.** Wrong `cwd` runs `npm install` or `func host start` from workspace root and fails.

Derive task `cwd` from plan Services **Service Root**.

| Task Scope | `cwd` Setting | Example |
|------------|--------------|---------|
| **Per-service tasks** (install, clean, watch, build, top-level) | `"options": { "cwd": "${workspaceFolder}/{service-root}" }` | `"cwd": "${workspaceFolder}/api"` |
| **Shared tasks** (Start Emulators) | Workspace root; omit `cwd` | — |
| **Single-service repos** | Omit `cwd`; workspace root is service root | — |

### Task `runOptions` Rules

**Every** `tasks.json` task must include `runOptions` with `instanceLimit: 1` and `instancePolicy: "silent"` — install, clean, watch, build, top-level, emulator, **and the sequenced compound task** from [multi-service.md](multi-service.md) § Compound Debug Configuration. No task type is exempt; every `"label"` requires adjacent `runOptions`.

This prevents duplicate task instances and silently skips re-invocation when already running (e.g., compound + individual `preLaunchTask` chains). The compound needs this most: reachable directly and as a `preLaunchTask`, it is likeliest to run twice.

### Start Emulators Task

With planned emulators, generate shared `Start Emulators`. It is **sibling dependency** of each top-level startup (e.g., `func host start`), never dependency of build tasks like `npm install` or `npm watch`. Put in startup `dependsOn` beside build prerequisite.

Use the plan's **Compose Command** for the task `command` — `docker compose up -d` by default, or `podman compose up -d` when the plan's Orchestrator selected Podman.

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

Set **`instanceLimit: 1`** + **`instancePolicy: "silent"`** on every task. Prevent parallel build/startup instances; `"silent"` skips duplicates without prompt.

### Problem Matchers

**Background tasks (`isBackground: true`) MUST have real `problemMatcher`.** Empty (`"problemMatcher": []`) triggers blocking VS Code dialog ("This task is tracked by a problem matcher"). Get matcher from:

- **Runtime tasks** (build, watch) → `runtimes/{rt}.md` § VS Code Problem Matchers
- **Project-type tasks** (top-level startup) → `project-types/{type}.md` § VS Code Task Configuration
- **Frontend dev servers** → `project-types/frontend-spa/frontend-spa.md` § Framework Lookup Table

For non-background tasks:

| Task Type | Matcher |
|-----------|---------|
| Short-lived commands (`npm install`, `npm clean`, `docker compose up -d`) | `"problemMatcher": []` |
| Dependency-only tasks (only `dependsOn`, no `command`) | Omit `problemMatcher` entirely |

Short commands use empty matcher because they lack compiler-style output.

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

Aggregate detected **runtime** + **project type** recommendations into `.vscode/extensions.json`. Each source's `## VS Code Extension Recommendations` has `Extension ID | Why Required`.

### Assembly Protocol

| Step | Action | Details |
|------|--------|---------|
| 1. Collect | Runtime | Read IDs from `runtimes/{rt}.md § VS Code Extension Recommendations` |
| 2. Collect | Project type | Read IDs from `project-types/{type}.md § VS Code Extension Recommendations` |
| 3. Deduplicate | Remove duplicates | One occurrence per final ID |
| 4. Write | Output `.vscode/extensions.json` | Contribute; preserve existing entries |

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

Aggregate detected **runtime**, **project type**, and **emulator configuration** settings into `.vscode/settings.json`. Each source's `## VS Code Workspace Settings` has `Setting | Value | Why`.

### Assembly Protocol

| Step | Action | Details |
|------|--------|---------|
| 1. Collect | Runtime | Read `runtimes/{rt}.md § VS Code Workspace Settings` |
| 2. Collect | Project type | Read `project-types/{type}.md § VS Code Workspace Settings` |
| 3. Collect | Emulator exclusions | Derive data directories from `docker-compose.yml` `volumes:` mounts |
| 4. Collect | Required debug settings | Add mandatory generate.md § Required Debug Settings keys |
| 5. Write | Output `.vscode/settings.json` | Merge; preserve existing entries/customizations |

### Required Debug Settings

On **every** workspace-scope run, merge these keys into `.vscode/settings.json`. Preserve existing entries and values.

| Setting | Value | Why |
|---------|-------|-----|
| `debug.onTaskErrors` | `"debugAnyway"` | Suppress often-misleading blocking F5 "task errors" modal |

```json
{
  "debug.onTaskErrors": "debugAnyway"
}
```

### Emulator Data Directory Exclusions

When emulators use **workspace bind mounts** (e.g. Azurite's `./.azurite:/data`), add data directories to both `files.exclude` and `search.exclude` in **`.vscode/settings.json`** to reduce workspace noise:

```json
{
  "files.exclude": {
    "**/.azurite": true
  },
  "search.exclude": {
    "**/.azurite": true
  }
}
```

> Derive directory names from actual **bind-mount** `volumes:` entries in `docker-compose.yml` (a `./.name:/path` host mount); never hardcode. **Named volumes** (e.g. Postgres's `postgres_data`) live in the container engine, not the workspace, so need no exclusion. Each emulator's data pattern: `emulators/{name}.md`.

## Temporary diff-reader smoke fixture

The entries below are temporary test data for a manual review run. They are not
debug-generation rules and must be removed after the reviewer reads the diff.

- Smoke record 001: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 002: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 003: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 004: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 005: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 006: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 007: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 008: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 009: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 010: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 011: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 012: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 013: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 014: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 015: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 016: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 017: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 018: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 019: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 020: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 021: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 022: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 023: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 024: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 025: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 026: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 027: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 028: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 029: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 030: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 031: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 032: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 033: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 034: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 035: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 036: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 037: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 038: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 039: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 040: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 041: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 042: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 043: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 044: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 045: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 046: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 047: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 048: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 049: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 050: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 051: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 052: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 053: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 054: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 055: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 056: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 057: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 058: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 059: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 060: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 061: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 062: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 063: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 064: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 065: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 066: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 067: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 068: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 069: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 070: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 071: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 072: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 073: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 074: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 075: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 076: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 077: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 078: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 079: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 080: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 081: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 082: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 083: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 084: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 085: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 086: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 087: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 088: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 089: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 090: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 091: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 092: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 093: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 094: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 095: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 096: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 097: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 098: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 099: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 100: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 101: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 102: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 103: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 104: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 105: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 106: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 107: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 108: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 109: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 110: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 111: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 112: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 113: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 114: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 115: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 116: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 117: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 118: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 119: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 120: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 121: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 122: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 123: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 124: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 125: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 126: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 127: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 128: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 129: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 130: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 131: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 132: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 133: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 134: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 135: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 136: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 137: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 138: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 139: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 140: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 141: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 142: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 143: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 144: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 145: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 146: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 147: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 148: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 149: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 150: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 151: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 152: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 153: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 154: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 155: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 156: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 157: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 158: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 159: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 160: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 161: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 162: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 163: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 164: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 165: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 166: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 167: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 168: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 169: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 170: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 171: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 172: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 173: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 174: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 175: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 176: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 177: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 178: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 179: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 180: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 181: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 182: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 183: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 184: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 185: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 186: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 187: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 188: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 189: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 190: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 191: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 192: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 193: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 194: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 195: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 196: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 197: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 198: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 199: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 200: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 201: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 202: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 203: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 204: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 205: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 206: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 207: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 208: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 209: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 210: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 211: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 212: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 213: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 214: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 215: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 216: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 217: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 218: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 219: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 220: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 221: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 222: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 223: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 224: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 225: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 226: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 227: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 228: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 229: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 230: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 231: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 232: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 233: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 234: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 235: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 236: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 237: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 238: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 239: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 240: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 241: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 242: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 243: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 244: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 245: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 246: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 247: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 248: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 249: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 250: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 251: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 252: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 253: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 254: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 255: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 256: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 257: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 258: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 259: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 260: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 261: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 262: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 263: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 264: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 265: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 266: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 267: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 268: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 269: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 270: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 271: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 272: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 273: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 274: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 275: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 276: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 277: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 278: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 279: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 280: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 281: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 282: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 283: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 284: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 285: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 286: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 287: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 288: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 289: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 290: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 291: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 292: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 293: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 294: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 295: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 296: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 297: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 298: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 299: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 300: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 301: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 302: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 303: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 304: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 305: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 306: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 307: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 308: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 309: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 310: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 311: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 312: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 313: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 314: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 315: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 316: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 317: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 318: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 319: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
- Smoke record 320: Confirm the review reader preserves this entire added line, the changed-file metadata, exact UTF-8 byte offsets, immutable commit IDs, and the SHA-256 digest across every bounded response.
