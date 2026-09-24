# {Type} — Project Type

> **Template** — Copy to `project-types/{type}.md` for a new server-side project type. For browser types, follow `project-types/frontend-spa/`; its Framework Lookup Table replaces Startup Command and debug adapters replace Debugger Properties.

---

## Detection Signals

<!-- Files/packages/patterns identifying this project type during planning. -->

| Signal | Notes |
|--------|-------|
| `{file}` | {description} |

---

## Prerequisites

<!-- Project-type tools or CLIs, excluding runtime requirements in runtimes/{rt}.md § Prerequisites.
     Example: Azure Functions Core Tools for functions.md. Omit if no additional tools are required. -->

| Tool | Detection Command | Required For | Install Link |
|------|-------------------|-------------|-------------|
| `{tool}` | `{command}` | {purpose} | `{install-url}` |

---

## Runtime Support Matrix

<!-- Implementation readiness, separate from Runtime Wiring.
     Set each runtime: ✅ Full, ⚠️ Emulators only, 🔲 Planned. -->

| Runtime | Status | Reference |
|---------|--------|-----------|
| node-ts | | |
| node-js | | |
| dotnet  | | |
| python  | | |
| java    | | |
| go      | | |

---

## Dependency Discovery

<!-- Find Azure dependencies via bindings, SDK scan, or framework conventions. -->
<!-- Map to emulators/{name}.md. -->

| Dependency Signal | Azure Service | Emulator |
|------------------|---------------|---------|
| `{signal}` | {service} | [{name}](../emulators/{name}.md) |

---

## Startup Command

<!-- Local startup. E.g.: func host start, docker compose up, npm run dev.
     For VS Code custom task types (e.g., "type": "func"), the extension supplies the executable
     prefix; omit it from task JSON command. Show full CLI equivalent here. -->

```
{command}
```

---

## Runtime Wiring

<!-- Map runtimes to project-type task configuration.
     See § VS Code Task Configuration for concrete task JSON per runtime.
     See generate.md § Source Ownership for combining project-type and runtime refs. -->

> See **§ VS Code Task Configuration** for concrete task JSON per runtime.

| Runtime | Startup task label | Task type | Problem matcher | Request Mode | Status | Reference |
|---------|--------------------|-----------|-----------------|--------------|--------|-----------|
| node-ts | {label} | {shell\|func\|...} | {matcher} | {attach\|launch} | | |
| node-js | {label} | {shell\|func\|...} | {matcher} | {attach\|launch} | | |
| dotnet  | {label} | {shell\|func\|...} | {matcher} | {attach\|launch} | | |
| python  | {label} | {shell\|func\|...} | {matcher} | {attach\|launch} | | |
| java    | {label} | {shell\|func\|...} | {matcher} | {attach\|launch} | | |
| go      | {label} | {shell\|func\|...} | {matcher} | {attach\|launch} | | |

### VS Code Debug Configuration

<!-- Only browser project types whose debugger comes from project type, not runtime
     (e.g., Frontend SPA uses "chrome"). Server types use runtimes/{rt}.md; omit for them. -->

### VS Code Task Configuration

<!-- Authoritative top-level task JSON for this project type.
     Give one concrete JSON block per implemented runtime with type, label, command,
     problemMatcher, isBackground, runOptions, and dependsOn.
     dependsOn references runtimes/{rt}.md § Build Chain task labels.
     See generate.md § Task runOptions Rules for instanceLimit and instancePolicy. -->

### Connection Strings

<!-- Emulator connection-string locations. E.g.: local.settings.json, .env, compose env vars -->

| Emulator | Key | Value | File |
|----------|-----|-------|------|
| {emulator} | `{VAR_NAME}` | `{value}` | `{file}` |

---

## API Test Collections

<!-- Test patterns to generate. Reference api-test-collections.md for script templates. -->

See [api-test-collections.md](../api-test-collections.md) for test script patterns.

---

## VS Code Extension Recommendations (`.vscode/extensions.json`)

<!-- Required project-type extensions. Into .vscode/extensions.json, generate.md aggregates them with runtime extensions. -->

| Extension ID | Why Required |
|--------------|-------------|
| `{extension-id}` | {reason} |

---

## VS Code Workspace Settings (`.vscode/settings.json`)

<!-- Project-type settings. Into .vscode/settings.json, generate.md aggregates them with runtime settings. -->

| Setting | Value | Why |
|---------|-------|-----|
| `{setting.key}` | `{value}` | {reason} |

---

## Validation Signals

<!-- validation.md uses these in Phase 3 to verify generated debug configuration.
     New project types MUST complete these tables. -->

### Ready Signal

| Top-Level Task | Ready Signal (stdout) |
|----------------|----------------------|
| {task label} | `"{pattern}"` |

### HTTP Verification

| Curl Target | Expected Status | Notes |
|-------------|-----------------|-------|
| `http://localhost:{port}/{path}` | `{status}` | {notes} |

---

## Checklist — {Type} Project Validation

<!-- Post-generation artifact check only; do not run or start anything. -->

After generating `launch.json`, `tasks.json`, and `extensions.json`, verify:

1. ✅ Startup task exists in `tasks.json` with correct type and problem matcher
2. ✅ `launch.json` `preLaunchTask` targets startup task
3. ✅ `.vscode/extensions.json` includes extensions above
4. ✅ `dependsOn` includes runtime build/watch task and `Start Emulators` when required

> Runtime checks (e.g., build task, debugger type) are in `runtimes/{rt}.md`.
