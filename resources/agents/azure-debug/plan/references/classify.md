# Classify Workspace

Determine the project type(s) and runtime(s) for each service root in the workspace. Classification produces an array of service contexts — even single-service workspaces produce a one-item list so the rest of the flow is uniform.

> **Always scan the full directory tree** — not just the workspace root. Service roots nested in subdirectories (e.g. `./api/`, `./web/`) must be found regardless of project layout.
> Ignore: `node_modules/`, `.git/`, `dist/`, `build/`, `bin/`, `obj/`.

### ⚠️ Exclude Non-Service Directories

Only include directories that represent **runnable services** (APIs, web apps, functions, workers, etc.). Exclude directories that are **shared libraries, utility packages, or common modules** — these are consumed by services but are not independently launchable and should never appear as a service.

Common exclusion signals:
- Directory name or `package.json` name contains `shared`, `common`, `utils`, `lib`, or `helpers`
- No entry point (no `main`, `start` script, `host.json`, `server.*`, or framework config)
- Used as a dependency by other service roots (e.g. via workspace references or `file:` dependencies)
- Project type is `library` — a package that exports modules but is not runnable on its own

---

## Step 1: Detect Project Types

Scan every subdirectory and classify each service root by project type. See [project-types.md](project-types.md) for the detection table and per-type nuances.

## Step 2: Detect Runtimes

For each service root, determine the language/runtime and version. See [runtimes.md](runtimes.md) for the detection table and per-runtime nuances.

## Output

Classification produces a `services[]` list of `{ root, projectType, runtime, ... }` entries. Even single-service workspaces produce a one-item list. This information will be used in follow-up sections.
