# Python — Debug & Build Configuration

> Covers Python services, including Python Azure Functions. Project-type hosting is defined in `project-types/{type}.md`; this file owns the interpreter, virtual environment, and debug adapter wiring.

## Prerequisites

| Tool | Detection Command | Required For | Install Link |
|------|-------------------|-------------|-------------|
| Python 3.12 | `python --version` | Run and debug Python services | [python.org](https://www.python.org/downloads/) |
| pip | `python -m pip --version` | Dependency management | Bundled with supported Python installers |
| Python extension | VS Code extension `ms-python.python` installed | Interpreter selection and Python debugging | [Marketplace](https://marketplace.visualstudio.com/items?itemName=ms-python.python) |
| Python Debugger extension | VS Code extension `ms-python.debugpy` installed | Contributes the `debugpy` debugger | [Marketplace](https://marketplace.visualstudio.com/items?itemName=ms-python.debugpy) |

---

## Debugger Properties

| Property | Value | Notes |
|----------|-------|-------|
| Debug protocol | `debugpy DAP` | Python debug adapter protocol |
| VS Code debugger type | `debugpy` | Contributed by `ms-python.debugpy` |
| Request mode | `attach` for Functions | The Functions host starts the language worker with debugpy |
| Base debug port | `9091` | Increment for additional Python services |

For Python Functions, generate an attach configuration:

```json
{
  "name": "{launch-config-name}",
  "type": "debugpy",
  "request": "attach",
  "connect": {
    "host": "localhost",
    "port": 9091
  },
  "preLaunchTask": "{service-id}: func host start",
  "justMyCode": true
}
```

---

## Virtual Environment Contract

Every Python service MUST use a project-local `.venv`. Do not install into the global interpreter and do not assume that creating the virtual environment makes the Functions host use it.

1. Create `.venv` with the supported project interpreter.
2. Install the most complete checked-in dependency file, preferring `requirements-dev.txt` when it includes `-r requirements.txt`; otherwise install `requirements.txt` and the project test/debug requirements.
3. Run the Functions language worker with `.venv/bin/python` (Windows: `.venv\\Scripts\\python.exe`) by setting `languageWorkers__python__defaultExecutablePath`.
4. Install `debugpy` in the same `.venv` that runs the language worker.

For macOS/Linux:

```json
{
  "type": "shell",
  "label": "{service-id}: install dependencies",
  "command": "python -m venv .venv && .venv/bin/python -m pip install -r requirements-dev.txt",
  "options": {
    "cwd": "${workspaceFolder}/{service-root}"
  },
  "problemMatcher": [],
  "runOptions": { "instanceLimit": 1, "instancePolicy": "silent" }
}
```

Use `.venv\\Scripts\\python.exe` in the command and worker path on Windows. If `requirements-dev.txt` does not exist, use the dependency source discovered in the project rather than inventing a file.

---

## Build Chain

```
"{service-id}: func host start"
       ├── dependsOn: "{service-id}: install dependencies"
       └── dependsOn: "Start Emulators"     ← only when emulators are required
```

The Functions startup task MUST bind both the debug arguments and worker executable to the project virtual environment:

```json
{
  "type": "func",
  "label": "{service-id}: func host start",
  "command": "host start",
  "options": {
    "cwd": "${workspaceFolder}/{service-root}",
    "env": {
      "languageWorkers__python__defaultExecutablePath": "${workspaceFolder}/{service-root}/.venv/bin/python",
      "languageWorkers__python__arguments": "-m debugpy --listen 9091"
    }
  },
  "problemMatcher": "$func-python-watch",
  "isBackground": true,
  "dependsOrder": "sequence",
  "dependsOn": ["{service-id}: install dependencies", "Start Emulators"],
  "runOptions": { "instanceLimit": 1, "instancePolicy": "silent" }
}
```

On Windows, use `${workspaceFolder}\\{service-root}\\.venv\\Scripts\\python.exe` for `languageWorkers__python__defaultExecutablePath`. Remove `Start Emulators` when the plan has no checked emulator.

---

## VS Code Extension Recommendations

| Extension ID | Why Required |
|--------------|-------------|
| `ms-python.python` | Python interpreter and environment support |
| `ms-python.debugpy` | Python debugger adapter |

## VS Code Workspace Settings

| Setting | Value | Why |
|---------|-------|-----|
| `python.defaultInterpreterPath` | `${workspaceFolder}/{service-root}/.venv/bin/python` | Uses the same interpreter as the Functions worker |
| `azureFunctions.pythonVenv` | `.venv` | Lets the Azure Functions extension recognize the project environment |
| `files.exclude: **/.venv` | `true` | Hides environment packages from the explorer |

Use the Windows interpreter path when generating for Windows.

---

## Checklist — Python Runtime Validation

1. ✅ The dependency task creates `.venv` and installs `debugpy`.
2. ✅ The Functions task sets `languageWorkers__python__defaultExecutablePath` to that `.venv` interpreter.
3. ✅ The Functions task sets `languageWorkers__python__arguments` to `-m debugpy --listen {port}`.
4. ✅ `launch.json` uses `debugpy`, `request: attach`, and the same port.
5. ✅ `python.defaultInterpreterPath` and `azureFunctions.pythonVenv` point to `.venv`.
6. ✅ `.vscode/extensions.json` recommends `ms-python.python` and `ms-python.debugpy`.

During live validation, require both the application readiness signal and a listening debugpy port before marking the configuration successful.
