# {Type} — Project Type

> **Template** — Copy this file to `project-types/{type}.md` when adding a new server-side project type. For browser-based project types, use `project-types/frontend-spa/` as a reference — the structure differs (Framework Lookup Table replaces Startup Command, debug adapters replace Debugger Properties).

---

## Detection Signals

<!-- Files/packages/patterns that identify this project type. Used during the plan phase. -->

| Signal | Notes |
|--------|-------|
| `{file}` | {description} |

---

## Prerequisites

<!-- Tools or CLIs required by this project type (not the runtime — those go in runtimes/{rt}.md § Prerequisites).
     Example: Azure Functions Core Tools for functions.md. Omit this section if the project type has no additional tool requirements. -->

| Tool | Detection Command | Required For | Install Link |
|------|-------------------|-------------|-------------|
| `{tool}` | `{command}` | {purpose} | `{install-url}` |

---

## Runtime Support Matrix

<!-- Tracks implementation readiness — separate from Runtime Wiring below.
     Fill in status per runtime: ✅ Full, ⚠️ Emulators only, 🔲 Planned. -->

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

<!-- How Azure service dependencies are found: bindings, SDK scan, or framework conventions. -->
<!-- Maps to emulators/{name}.md entries. -->

| Dependency Signal | Azure Service | Emulator |
|------------------|---------------|---------|
| `{signal}` | {service} | [{name}](../emulators/{name}.md) |

---

## Startup Command

<!-- How the app starts locally. E.g.: func host start, docker compose up, npm run dev.
     For VS Code custom task types (e.g., "type": "func"), the executable prefix is supplied
     by the extension — omit it from the task JSON command. Show the full CLI equivalent here. -->

```
{command}
```

---

## Runtime Wiring

<!-- Quick-reference index mapping runtimes to project-type-specific task configuration.
     See § VS Code Task Configuration below for the concrete task JSON per runtime.
     See generate.md § Source Ownership for how project-type and runtime refs combine. -->

> See **§ VS Code Task Configuration** below for the concrete task JSON for each runtime.

| Runtime | Startup task label | Task type | Problem matcher | Request Mode | Status | Reference |
|---------|--------------------|-----------|-----------------|--------------|--------|-----------|
| node-ts | {label} | {shell\|func\|...} | {matcher} | {attach\|launch} | | |
| node-js | {label} | {shell\|func\|...} | {matcher} | {attach\|launch} | | |
| dotnet  | {label} | {shell\|func\|...} | {matcher} | {attach\|launch} | | |
| python  | {label} | {shell\|func\|...} | {matcher} | {attach\|launch} | | |
| java    | {label} | {shell\|func\|...} | {matcher} | {attach\|launch} | | |
| go      | {label} | {shell\|func\|...} | {matcher} | {attach\|launch} | | |

### VS Code Debug Configuration

<!-- Only needed for browser-based project types where the debugger type comes from the project type
     rather than the runtime (e.g., Frontend SPA uses "chrome").
     Server-side project types get their debugger type from runtimes/{rt}.md instead — omit this section for those. -->

### VS Code Task Configuration

<!-- THE authoritative source for top-level task JSON for this project type.
     Provide one concrete JSON block per implemented runtime.
     Include type, label, command, problemMatcher, isBackground, runOptions, and dependsOn.
     The dependsOn array references task labels from runtimes/{rt}.md § Build Chain.
     See generate.md § Task runOptions Rules for instanceLimit and instancePolicy guidance. -->

### Connection Strings

<!-- Where emulator conn strings are placed. E.g.: local.settings.json, .env, compose env vars -->

| Emulator | Key | Value | File |
|----------|-----|-------|------|
| {emulator} | `{VAR_NAME}` | `{value}` | `{file}` |

---

## API Test Collections

<!-- Which test patterns to generate for this project type. Reference api-test-collections.md for the script templates. -->

See [api-test-collections.md](../api-test-collections.md) for all test script patterns.

---

## VS Code Extension Recommendations (`.vscode/extensions.json`)

<!-- Extensions required by this project type. Aggregated with runtime extensions into .vscode/extensions.json by generate.md. -->

| Extension ID | Why Required |
|--------------|-------------|
| `{extension-id}` | {reason} |

---

## VS Code Workspace Settings (`.vscode/settings.json`)

<!-- Settings contributed by this project type. Aggregated with runtime settings into .vscode/settings.json by generate.md. -->

| Setting | Value | Why |
|---------|-------|-----|
| `{setting.key}` | `{value}` | {reason} |

---

## Validation Signals

<!-- Used by validation.md during Phase 3 to verify the generated debug configuration works.
     When adding a new project type, you MUST fill in these tables — validation.md references them. -->

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

<!-- Post-generation self-check for this project type. Verify generated artifacts are correct — do not run or start anything. -->

After generating `launch.json`, `tasks.json`, and `extensions.json`, verify the following were produced correctly:

1. ✅ Startup task exists in `tasks.json` with the correct type and problem matcher
2. ✅ `launch.json` `preLaunchTask` points to the startup task
3. ✅ `.vscode/extensions.json` includes project-type extensions listed above
4. ✅ `dependsOn` chain includes runtime build/watch task and `Start Emulators` (when emulators are required)

> Runtime-specific checks (e.g., build task, debugger type) are defined in `runtimes/{rt}.md`.
