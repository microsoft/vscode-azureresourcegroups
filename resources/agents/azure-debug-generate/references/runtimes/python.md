# Python - Debug & Build Configuration

> Implemented for local CPython Azure Functions services with the v4 host and Python v2 programming model; host/task wiring belongs to [project-types/functions.md](../project-types/functions.md).

For a custom Python API, preserve its actual framework and obtain startup/debug mode from its project-type reference or approved best-effort configuration. The interpreter/dependency conventions still apply, but the Functions-specific example below must not convert that service into Functions. Missing project-type support retains its own warning.

---

## Prerequisites

| Tool | Detection Command | Required For | Install Link |
|------|-------------------|-------------|-------------|
| Compatible CPython | `<selected-python> --version` and `sys.executable` | Runtime matching `requires-python`, the service venv, and Functions v4 | [python.org](https://www.python.org/downloads/) |
| pip | `<venv-python> -m pip --version` | Restore this environment's dependencies | [pip installation](https://pip.pypa.io/en/stable/installation/) |

Follow [shared Python prerequisite checks](../../../shared-references/prerequisites.md#python-interpreter-and-environment-compatibility). Respect an existing Poetry/uv project and its environment; do not mix its lockfile with an unrelated global pip. Core Tools and the Functions extension belong to the project-type reference.

## Interpreter Resolution

Resolve the service root, selected interpreter, and venv from the runtime inventory, `.azure/integration-plan.md`, manifests, and existing settings. Confirm the venv's version and executable directly. If missing, create it with the confirmed compatible base interpreter before validation; never silently recreate an existing environment or downgrade its Python version.

Default new projects to a **service-local `.venv`**. `<venv-python>` is `.venv/bin/python` on macOS/Linux or `.venv/Scripts/python.exe` on Windows when tasks run from that service. For existing root/manager-owned environments, substitute their actual paths consistently in tasks and settings.

`python.defaultInterpreterPath` supplies an initial Python-extension selection. If VS Code has cached a different interpreter, select the service venv with **Python: Select Interpreter**. Project-type worker configuration remains separate; see that reference's VS Code Workspace Settings.

## Debugger Properties

| Property | Value | Notes |
|----------|-------|-------|
| Debug protocol | `debugpy DAP` | Python debugger |
| VS Code debugger type | `debugpy` | Never the deprecated `python` adapter |
| Base debug port | `9091` | Subject to project-type Runtime Wiring constraints |
| Source filtering | `justMyCode: true` | Local sources already use local filesystem paths |

Example combined with Functions Runtime Wiring:

```json
{
  "name": "Python API (debug)",
  "type": "debugpy",
  "request": "attach",
  "connect": { "host": "127.0.0.1", "port": 9091 },
  "justMyCode": true,
  "preLaunchTask": "{service-id}: func host start"
}
```

Use the plan's Launch Config Name and the project type's request mode and startup task. Local attachment needs no invented `pathMappings`, `outFiles`, or TypeScript source-map settings.

### VS Code Problem Matchers

| Task | Watch Problem Matcher | Build Problem Matcher |
|------|-----------------------|----------------------|
| Dependency restore / compile check | N/A | `[]` (short-lived tasks) |

Python needs no fake compiler watcher. The project type supplies any host background matcher; restore/compile tasks finish before startup.

## Build Chain

```text
"{service-id}: {startup task}"                  <- project-type task
    dependsOn: "{service-id}: python compile"
        dependsOn: "{service-id}: pip install"
    dependsOn: "Start Emulators"                <- only checked emulators
```

> **Task label scoping:** Prefix every task label with service ID; see [generate.md § Service ID Derivation](../generate.md).

### Build Commands

| Step | Task Label | Command | Purpose | Background? |
|------|------------|---------|---------|-------------|
| Prepare venv, if absent | Generation preflight | `<selected-python> -m venv <venv-path>` | Create the selected environment | No |
| Restore | `{service-id}: pip install` | `<venv-python> -m pip install -r requirements.txt` | Restore service dependencies | No |
| Compile | `{service-id}: python compile` | `<venv-python> -m compileall -q <actual-source-paths>` | Check source syntax | No |

Append `-r requirements-dev.txt` to restore only when that file exists and its tools are needed. For Poetry/uv, use the existing manager's native restore command targeting the same venv. Keep production `requirements.txt` consistent with the declared runtime dependencies.

Example tasks for a service-local venv:

```json
{
  "type": "process",
  "label": "{service-id}: pip install",
  "command": "${workspaceFolder}/{service-root}/.venv/bin/python",
  "windows": { "command": "${workspaceFolder}/{service-root}/.venv/Scripts/python.exe" },
  "args": ["-m", "pip", "install", "-r", "requirements.txt"],
  "options": { "cwd": "${workspaceFolder}/{service-root}" },
  "problemMatcher": [],
  "runOptions": { "instanceLimit": 1, "instancePolicy": "silent" }
}
```

```json
{
  "type": "process",
  "label": "{service-id}: python compile",
  "command": "${workspaceFolder}/{service-root}/.venv/bin/python",
  "windows": { "command": "${workspaceFolder}/{service-root}/.venv/Scripts/python.exe" },
  "args": ["-m", "compileall", "-q", "function_app.py", "functions", "services", "shared", "errors", "middleware", "logger.py"],
  "options": { "cwd": "${workspaceFolder}/{service-root}" },
  "problemMatcher": [],
  "runOptions": { "instanceLimit": 1, "instancePolicy": "silent" },
  "dependsOn": ["{service-id}: pip install"]
}
```

Replace the source list with existing application paths; exclude `.venv`, dependency trees, and generated caches. No bare `py_compile` without filenames, global pip, npm build, or `dist` assumptions. Verify `<venv-python> -m pip check` during generation/validation.

## Convenience Scripts

Plan Convenience Scripts defines WHICH scripts; this section defines HOW Python registers them.

**Script runner:** Existing `pyproject.toml` runner or small Python scripts in `scripts/`
**Run command pattern:** The existing manager's script command or `<venv-python> scripts/{script}.py`

### Script Format

Preserve the native runner's entry format. For a plain script, add a `main()` entry point guarded by `if __name__ == "__main__":` and invoke it with the selected venv interpreter. Do not add `package.json` or a Node dependency solely to drive a Python API.

### Common Script Implementations

| Script Purpose | Implementation |
|----------------|----------------|
| Start/stop emulators | Plan's Compose Command with `up -d` / `down` |
| Clean emulator data | Stop plan-owned containers/volumes first, then remove only resolved emulator data directories after required confirmation |
| Run migrations | Register the project-native command resolved by [migrations.md](../migrations.md), using the selected service environment |

## VS Code Extension Recommendations (`.vscode/extensions.json`)

| Extension ID | Why Required |
|--------------|-------------|
| `ms-python.python` | Interpreter selection and Functions debugger launcher API |
| `ms-python.debugpy` | `debugpy` attach adapter |

The Functions extension is contributed separately by the project-type reference. Its native task obtains the debugger launcher from these extensions; do not inject `-m debugpy` or require debugpy in production requirements for this path.

## VS Code Workspace Settings (`.vscode/settings.json`)

| Setting | Value | Why |
|---------|-------|-----|
| `python.defaultInterpreterPath` | `${workspaceFolder}/{service-root}/.venv` (or actual venv directory) | Platform-independent initial interpreter selection |

Functions owns `azureFunctions.*` settings and their folder/service-relative semantics.

## Checklist - Python Runtime Validation

Mandatory after generation. Artifact checks run first; live checks run during validation after project-type startup and HTTP verification.

### Post-Generation Checks

1. Restore/compile tasks run in the actual service root with its venv interpreter and platform-specific executable path.
2. `launch.json` uses `debugpy` and the runtime's debugger properties, combined with the project type's Runtime Wiring.
3. Extension recommendations include both Python extensions plus the project-type extension.
4. Every imported production package is declared in the service's dependency manifest.

### Live Validation Checks

1. Confirm the selected venv's version, executable, dependencies (`-m pip check`), and source compilation.
2. Confirm the configured debugger listener is ready and uses the same port as the running worker.
3. When debug controls are available, attach and hit a breakpoint in an application handler. Record attachment evidence separately from HTTP checks. If debugger controls are unavailable, explicitly record it as unverified.

Project-type checks own native host execution and route registration; [validation.md](../validation.md) owns orchestration, evidence reporting, and teardown. Do not expose interpreter paths through a production health response to obtain debugger evidence.
