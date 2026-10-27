# {Runtime} — Debug & Build Configuration

> **Template** — Copy to `runtimes/{rt}.md` for new runtime.

---

## Prerequisites

<!-- Required language toolchain only: tools, SDKs, version managers. -->
<!-- Exclude project-type tools (e.g., Functions Core Tools belongs in functions.md). -->

| Tool | Detection Command | Required For | Install Link |
|------|-------------------|-------------|-------------|
| `{tool}` | `{tool} --version` | {purpose} | `{install-url}` |

---

## Debugger Properties

<!-- Runtime-generic debug properties.
     See project-types/{type}.md § Runtime Wiring for host-command combination.
     See generate.md § Source Ownership for reference composition. -->

| Property | Value | Notes |
|----------|-------|-------|
| Debug protocol | `{protocol}` | Runtime wire protocol (e.g., `Node Inspector`, `CoreCLR DAP`, `debugpy DAP`, `JDWP`, `Delve DAP`). |
| VS Code debugger type | `{type}` | VS Code debugger adapter ID (e.g., `node`, `coreclr`, `debugpy`, `java`, `go`). |
| Base debug port | `{port}` | Runtime default; overridden per service in monorepos |

### VS Code Problem Matchers

<!-- Problem matchers for VS Code tasks.json. -->

| Task | Watch Problem Matcher | Build Problem Matcher |
|------|----------------------|----------------------|
| {task} | `{matcher}` | `{matcher}` |

---

## Build Chain

<!-- Runtime-owned build steps: install, build/watch.
     Project type Runtime Wiring table provides startup task.
     Wire: startup depends on ["build/watch step", "Start Emulators"]. -->

Chain shape (project type supplies startup):

```
"{service-id}: {startup task}"              ← from project-types/{type}.md Runtime Wiring
       ├── dependsOn: "{service-id}: {build/watch step}"  ← this file
       └── dependsOn: "Start Emulators"     ← only when emulators are required
```

> **Task label scoping:** Prefix every task label with service ID derived from plan Service Label. See [generate.md § Service ID Derivation](../generate.md).

### Build Commands

| Step | Command | Purpose | Background? |
|------|---------|---------|------------|
| Start Emulators | `docker compose up -d` | Start all emulator services (idempotent — no-op if already running) | No |

See [generate.md](../generate.md) § Task `runOptions` Rules for rendering build steps into VS Code tasks.

---

## Convenience Scripts

<!-- HOW runtime registers scripts (package.json, Makefile, pyproject.toml, scripts/ dir).
     Plan Convenience Scripts defines WHICH; never hardcode names here. -->

Plan Convenience Scripts defines WHICH scripts; this section defines HOW runtime registers them.

**Script runner:** `{file}` (e.g., `package.json` scripts, `scripts/` directory, `Makefile`, `pyproject.toml`)
**Run command pattern:** `{command}` (e.g., `npm run {script}`, `./scripts/{script}.sh`)

> If script runner is not cross-platform (e.g., standalone scripts vs `package.json`), generate platform-specific scripts or document alternatives.

### Script Format

<!-- Format for adding runtime script-runner entry. -->

### Common Script Implementations

Use these implementations for planned scripts:

| Script Purpose | Typical Command | Notes |
|---------------|-----------------|-------|
| Start emulators | `docker compose up -d` | Idempotent; safe to re-run |
| Stop emulators | `docker compose down` | Stops and removes containers |
| Clean emulator data | Stop containers with volumes, then remove bind-mount data directories | Run `docker compose down -v` (`-v` also drops **named volumes** like Postgres's `postgres_data`), then remove `{data-dirs}` = `./.{name}` **bind-mount** directories derived from `docker-compose.yml` `volumes:` mounts. Use platform-appropriate removal. |
| Run migrations | `{migration tool CLI command}` | Derive via [migrations.md](../migrations.md) |

---

## VS Code Extension Recommendations (`.vscode/extensions.json`)

<!-- Runtime-required extensions; generate.md aggregates with project-type extensions into .vscode/extensions.json. -->

| Extension ID | Why Required |
|--------------|-------------|
| `{extension-id}` | {reason} |

---

## VS Code Workspace Settings (`.vscode/settings.json`)

<!-- Runtime-contributed settings; generate.md aggregates with project-type settings into .vscode/settings.json. -->

| Setting | Value | Why |
|---------|-------|-----|
| `{setting.key}` | `{value}` | {reason} |

---

## Checklist — {Runtime} Validation

> ⛔ **MANDATORY — Phase 3 after all artifacts.** Verify every item; never skip, assume, or approximate.

<!-- Runtime post-generation artifact check only; run/start nothing. -->

After VS Code config generation, verify:

### Post-Generation Checks

1. ✅ Build task exists in `tasks.json` with the correct problem matcher
2. ✅ `launch.json` uses the correct debugger type and request mode
3. ✅ `.vscode/extensions.json` includes runtime extensions listed above

### Live Validation Checks

<!-- Run during Phase 3 validation (validation.md Step 7), after ready signal.
     Add debugger-specific checks (e.g., process attachment, source maps).
     validation.md delegates here; added checks WILL run. -->

> `project-types/{type}.md` defines project-type checks (e.g., startup task, connection strings).
