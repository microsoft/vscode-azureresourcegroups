# {Runtime} — Debug & Build Configuration

> **Template** — Copy this file to `runtimes/{rt}.md` when adding a new runtime.

---

## Prerequisites

<!-- Required tools, SDKs, version managers — language toolchain only. -->
<!-- Do NOT list project-type-specific tools here (e.g., Functions Core Tools belongs in functions.md). -->

| Tool | Detection Command | Required For | Install Link |
|------|-------------------|-------------|-------------|
| `{tool}` | `{tool} --version` | {purpose} | `{install-url}` |

---

## Debugger Properties

<!-- Generic debug properties for this runtime.
     See project-types/{type}.md § Runtime Wiring for how these combine with the host command.
     See generate.md § Source Ownership for how runtime and project-type refs compose. -->

| Property | Value | Notes |
|----------|-------|-------|
| Debug protocol | `{protocol}` | The wire protocol the runtime exposes (e.g., `Node Inspector`, `CoreCLR DAP`, `debugpy DAP`, `JDWP`, `Delve DAP`). |
| VS Code debugger type | `{type}` | The VS Code debugger adapter identifier (e.g., `node`, `coreclr`, `debugpy`, `java`, `go`). |
| Base debug port | `{port}` | Default debug port for this runtime; overridden per-service in monorepos |

### VS Code Problem Matchers

<!-- Problem matchers for VS Code tasks.json. -->

| Task | Watch Problem Matcher | Build Problem Matcher |
|------|----------------------|----------------------|
| {task} | `{matcher}` | `{matcher}` |

---

## Build Chain

<!-- Build steps owned by this runtime: install, build/watch.
     The startup task is provided by the project type's Runtime Wiring table, not this file.
     Wire: startup task depends on ["build/watch step", "Start Emulators"]. -->

Chain shape (startup task comes from the project type):

```
"{service-id}: {startup task}"              ← from project-types/{type}.md Runtime Wiring
       ├── dependsOn: "{service-id}: {build/watch step}"  ← this file
       └── dependsOn: "Start Emulators"     ← only when emulators are required
```

> **Task label scoping:** All task labels MUST be prefixed with the service ID derived from the plan's Service Label column. See [generate.md § Service ID Derivation](../generate.md).

### Build Commands

| Step | Command | Purpose | Background? |
|------|---------|---------|------------|
| Start Emulators | `docker compose up -d` | Start all emulator services (idempotent — no-op if already running) | No |

See [generate.md](../generate.md) § Task `runOptions` Rules for how these build steps are rendered into VS Code task configuration.

---

## Convenience Scripts

<!-- HOW scripts are registered for this runtime (package.json, Makefile, pyproject.toml, scripts/ dir).
     The plan's Convenience Scripts table drives WHICH scripts to generate — do not hardcode script names here. -->

The plan's Convenience Scripts table specifies WHICH scripts to generate. This section covers HOW to register them for this runtime.

**Script runner:** `{file}` (e.g., `package.json` scripts, `scripts/` directory, `Makefile`, `pyproject.toml`)
**Run command pattern:** `{command}` (e.g., `npm run {script}`, `./scripts/{script}.sh`)

> When the runtime's script runner is not inherently cross-platform (e.g., standalone scripts vs `package.json`), generate platform-appropriate scripts or document cross-platform alternatives.

### Script Format

<!-- Show the format for adding a script entry to this runtime's script runner. -->

### Common Script Implementations

Use these implementations when building scripts from the plan:

| Script Purpose | Typical Command | Notes |
|---------------|-----------------|-------|
| Start emulators | `docker compose up -d` | Idempotent — safe to re-run |
| Stop emulators | `docker compose down` | Stops and removes containers |
| Clean emulator data | Stop containers and remove data directories | `{data-dirs}` = `./.{name}` directories derived from `docker-compose.yml` `volumes:` mounts. Use platform-appropriate removal. |
| Run migrations | `{migration tool CLI command}` | See [migrations.md](../migrations.md) for how to determine the command |

---

## VS Code Extension Recommendations (`.vscode/extensions.json`)

<!-- Extensions required by this runtime. Aggregated with project-type extensions into .vscode/extensions.json by generate.md. -->

| Extension ID | Why Required |
|--------------|-------------|
| `{extension-id}` | {reason} |

---

## VS Code Workspace Settings (`.vscode/settings.json`)

<!-- Settings contributed by this runtime. Aggregated with project-type settings into .vscode/settings.json by generate.md. -->

| Setting | Value | Why |
|---------|-------|-----|
| `{setting.key}` | `{value}` | {reason} |

---

## Checklist — {Runtime} Validation

> ⛔ **MANDATORY — runs during Phase 3 validation after all artifacts are generated.** You MUST verify every item below. Do NOT skip, assume, or approximate results.

<!-- Post-generation self-check for this runtime. Verify generated artifacts are correct — do not run or start anything. -->

After generating VS Code configuration, verify the following were produced correctly:

### Post-Generation Checks

1. ✅ Build task exists in `tasks.json` with the correct problem matcher
2. ✅ `launch.json` uses the correct debugger type and request mode
3. ✅ `.vscode/extensions.json` includes runtime extensions listed above

### Live Validation Checks

<!-- These checks run during Phase 3 validation (validation.md Step 7), after the ready signal is observed.
     Add debugger-specific verifications here (e.g., process attachment, source map verification).
     validation.md delegates to this section — if you add checks here, they WILL be executed. -->

> Project-type-specific checks (e.g., startup task, connection strings) are defined in `project-types/{type}.md`.
