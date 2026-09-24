# Python - Debug & Build Configuration

> 🔲 Planned: best-effort local debugging guidance for Python Azure Functions.
> Emit the limited-support warning and obtain consent per
> [limited-support.md](../limited-support.md) before generating artifacts.
> Do not treat this reference as evidence of verified end-to-end support.

## Prerequisites

| Tool | Detection Command | Required For | Install Link |
|------|-------------------|--------------|-------------|
| Python | `python --version` or `python3 --version` | Interpreter compatible with the service's declared version | [python.org](https://www.python.org/downloads/) |
| pip | `python -m pip --version` | Installing a `requirements.txt` dependency set | [pip documentation](https://pip.pypa.io/en/stable/) |

The `functions` project-type reference owns Core Tools and the Functions
extension. For Python debugger attachment, also require the
`ms-python.python` extension. Check that a compatible interpreter and
virtual environment exist in the service root before creating launch or
task entries. Prefer an existing `.venv` or `venv`; do not replace it or
rewrite a dependency manifest. If none exists, create one with the
selected interpreter and verify its version before using it. On macOS or
Linux the executable is `{venv}/bin/python`; on Windows it is
`{venv}\Scripts\python.exe`. Run the interpreter from the environment
directly rather than assuming the VS Code terminal has activated it.

## Debugger Properties

| Property | Value | Notes |
|----------|-------|-------|
| Debug protocol | `debugpy DAP` | VS Code Python extension provides the debugger |
| VS Code debugger type | `debugpy` | Attach to the Python Functions worker, not the Core Tools process |
| Base debug port | `9091` | Python worker debugger; Functions HTTP remains on its own port |
| Request mode | `attach` | Start the host through the Functions task first |

Use the Functions extension's Python worker launcher rather than supplying
static `languageWorkers__python__arguments`. Its task provider obtains the
launcher command from the installed Python extension. The `func` task
must run from the Python Functions service root; select that service's
virtual environment in VS Code. Verify the worker actually listens on
9091 before treating a successful host start as a debugger attach.

```json
{
  "name": "{Debug Config Name}",
  "type": "debugpy",
  "request": "attach",
  "connect": { "host": "localhost", "port": 9091 },
  "preLaunchTask": "{service-id}: func host start",
  "justMyCode": false
}
```

The name comes from the plan's Debug Config Name cell; the service ID
comes from its Service Label. For multiple Python services, allocate a
distinct debugger port per worker and configure the Functions extension's
worker launcher to use the matching port. If that pairing cannot be
confirmed, do not claim the compound debug configuration works.

### VS Code Problem Matchers

| Task | Watch Problem Matcher | Build Problem Matcher |
|------|----------------------|----------------------|
| `func host start` | `$func-python-watch` | - |
| `python install` | - | - |

The Functions project type owns the background host task and its matcher.
Installation is a foreground task and uses `problemMatcher: []`.

## Build Chain

Python has no compilation or watch task. The runtime owns environment
selection and dependency installation; the Functions project type owns
host startup and its dependency wiring.

```
"{service-id}: func host start"        <- project-types/functions.md
       +-- dependsOn: "{service-id}: python install"
       +-- dependsOn: "Start Emulators"   (only when planned)
```

### Build Commands

| Step | Task Label | Command | Purpose | Background? |
|------|------------|---------|---------|-------------|
| install | `{service-id}: python install` | `{venv-python} -m pip install -r requirements.txt` | Install declared Functions dependencies in the selected environment | No |

For the common `requirements.txt` layout, render the install task as a
`process` task using the resolved interpreter path as `command`, with
`["-m", "pip", "install", "-r", "requirements.txt"]` as `args`,
`problemMatcher: []`, and
`runOptions: { "instanceLimit": 1, "instancePolicy": "silent" }`.
Set `options.cwd` to the plan's Service Root in multi-service workspaces.
Use the platform-correct executable path (including a Windows task
override where needed). Do not run global `pip` or install packages
outside the service's environment.

```json
{
  "label": "{service-id}: python install",
  "type": "process",
  "command": "${workspaceFolder}/{path-to-functions-project}/.venv/bin/python",
  "args": ["-m", "pip", "install", "-r", "requirements.txt"],
  "options": { "cwd": "${workspaceFolder}/{path-to-functions-project}" },
  "windows": {
    "command": "${workspaceFolder}\\{path-to-functions-project}\\.venv\\Scripts\\python.exe"
  },
  "problemMatcher": [],
  "runOptions": { "instanceLimit": 1, "instancePolicy": "silent" }
}
```

Resolve both placeholders from the plan and detected environment. For a
workspace-root service, use `${workspaceFolder}` without an extra path.
If the existing environment is named `venv` rather than `.venv`, use its
actual path in both platform commands.

For `pyproject.toml` or `Pipfile` without `requirements.txt`, derive the
install command from the project's existing lockfile and documented
tooling. Do not invent `requirements.txt`, add a second package manager,
or run `pip install -r requirements.txt` when the file is absent. If no
repeatable install command exists, surface that blocker and mark this
configuration incomplete rather than writing a task that fails every F5.

See [generate.md](../generate.md) for service-ID task labels, `cwd`,
`runOptions`, and emulator sibling dependencies.

## Convenience Scripts

The plan's checked Convenience Scripts rows define which scripts to
create. A Python project has no built-in `npm run` equivalent: use
existing project tooling if it already defines commands, otherwise
register platform-appropriate scripts under `scripts/` without changing
the application's entry point. Preserve the plan's script names and
path; do not generate unrequested scripts.

| Script Purpose | Typical Command | Notes |
|---------------|-----------------|-------|
| Start emulators | `{Compose Command} up -d` | Use the plan's Orchestrator value |
| Stop emulators | `{Compose Command} down` | Leave data volumes intact |
| Clean emulator data | `{Compose Command} down -v` | Confirm before deleting volumes or bind-mounted data |
| Run migrations | `{venv-python} -m {existing migration tool}` | Derive from [migrations.md](../migrations.md), never guess |

Use `.sh` on macOS/Linux and `.ps1` on Windows when no script runner
exists. Existing scripts and project configuration take precedence;
merge only checked entries and never overwrite them silently.

## VS Code Extension Recommendations (`.vscode/extensions.json`)

| Extension ID | Why Required |
|--------------|-------------|
| `ms-python.python` | Provides Python interpreter selection and the `debugpy` debugger |

The Functions project type contributes `ms-azuretools.vscode-azurefunctions`;
generation deduplicates both recommendations.

## VS Code Workspace Settings (`.vscode/settings.json`)

| Setting | Value | Why |
|---------|-------|-----|
| `python.defaultInterpreterPath` | Path to this service's selected venv interpreter | Keep F5 attached to the same environment as the host |

Add the setting only when a single Python environment applies to the
workspace and no existing interpreter selection conflicts. In a
multi-service workspace with different Python environments, leave the
global setting untouched and use per-service task/interpreter paths.

## Checklist - Python Runtime Validation

### Post-Generation Checks

1. Confirm `Values.FUNCTIONS_WORKER_RUNTIME` is `python` in the Functions
   service's `local.settings.json`, without replacing its connection keys.
2. Confirm `{service-id}: python install` uses a real dependency manifest
   and the interpreter selected for that service.
3. Confirm `launch.json` uses `debugpy` attach on port 9091 (or its
   verified per-service port) and points to the matching `func` task.
4. Confirm `tasks.json` includes the Python host matcher, a foreground
   install step, and emulator startup only when planned.
5. Confirm `.vscode/extensions.json` recommends `ms-python.python` and
   `ms-azuretools.vscode-azurefunctions`.

### Live Validation Checks

1. Start the configured host and confirm the Python worker starts with
   the selected venv; a ready host alone does not prove debugger attach.
2. Confirm the Python worker debugger listens on the configured port,
   and attach from VS Code to verify a breakpoint in a registered
   function or route binds. If no trigger can be invoked, report that
   breakpoint execution was not verified rather than recording success.
3. Invoke an existing anonymous HTTP trigger when available, or document
   the reason HTTP verification is skipped; use the Functions project
   type's ready signal and application port, not port 9091.
4. Stop the Functions host, Python worker, and emulators started for
   validation. Confirm the HTTP and debugger ports are free before
   marking the plan Implemented.
