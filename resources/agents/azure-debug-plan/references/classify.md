# Classify Workspace

Determine each workspace service root's project type and runtime. Produce service-context array; single-service workspaces still produce one item for uniform flow.

> **Always scan full directory tree**, not only workspace root. Find nested service roots (e.g. `./api/`, `./web/`) regardless of layout.
> Ignore: `node_modules/`, `.git/`, `dist/`, `build/`, `bin/`, `obj/`.

### ⚠️ Exclude Non-Service Directories

Include only **runnable services** (APIs, web apps, functions, workers, etc.). Exclude **shared libraries, utility packages, and common modules** consumed by services but not independently launchable.

Common exclusion signals:
- Directory or `package.json` name contains `shared`, `common`, `utils`, `lib`, or `helpers`
- No entry point: no `main`, `start` script, `host.json`, `server.*`, or framework config
- Dependency of other service roots, e.g. workspace references or `file:` dependencies
- Project type `library`: exports modules, not independently runnable

---

## Step 1: Detect Project Types

Scan every subdirectory; classify each service root by project type using [project-types.md](project-types.md)'s detection table and nuances.

## Step 2: Detect Runtimes

Determine each service root's language/runtime and version using [runtimes.md](runtimes.md)'s detection table and nuances.

## Output

Output `services[]` list of `{ root, projectType, runtime, ... }` entries; use one item even for single-service workspaces. Follow-up sections consume it.
