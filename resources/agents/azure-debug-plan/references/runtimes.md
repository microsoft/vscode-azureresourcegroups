# Runtimes

> **Common examples, not exhaustive.** For unlisted runtime, identify from present
> language and toolchain (e.g. `rust`, `ruby`, etc.).

## Detection Table

| Detection Signals | Runtime | Version Source |
|-------------------|---------|---------------|
| `package.json` + `tsconfig.json` | **node-ts** | `engines.node` / `.nvmrc` / `.node-version` |
| `package.json` (no `tsconfig.json`) | **node-js** | Same |
| `*.csproj` | **dotnet** | `<TargetFramework>` element (e.g. `net8.0` → `8.0`) |
| `requirements.txt`, `pyproject.toml`, or `Pipfile` | **python** | `.python-version` / `pyproject.toml` `requires-python` / active interpreter |
| `pom.xml` or `build.gradle` | **java** | `<java.version>` / `sourceCompatibility` |
| `go.mod` | **go** | `go` directive in `go.mod` |

---

## dotnet

### Version Detection

Read `<TargetFramework>` from `.csproj` for runtime version (e.g. `net8.0` → `8.0`).

### Assembly Name

Derive plan Service Label assembly name:

1. If `<AssemblyName>` set → use its value
2. Otherwise → `.csproj` filename without extension (e.g. `Functions.csproj` → `Functions`)

## python

### Interpreter and dependency discovery

For each runnable Python service, check its own root for `.python-version`,
`pyproject.toml` (`requires-python`), `Pipfile`, `requirements.txt`, and an
existing `.venv` or `venv`. Record the interpreter version found by probing
the selected interpreter, not merely the range declared in `pyproject.toml`.
If the declared range and interpreter disagree, record the requirement and
mark the Python prerequisite ❓ for user review; do not pick another
interpreter silently.

Distinguish Azure Functions (`host.json` plus Python Functions source or
`FUNCTIONS_WORKER_RUNTIME=python`) from Flask/FastAPI services. Keep the
existing `functions` versus `app-service` project-type classification;
Python alone does not determine the host or debugger startup command.
Flask and FastAPI projects without `host.json` remain `app-service`; do
not generate a Functions task for them merely because the runtime is Python.
For Functions, note whether routes use the v2 `function_app.py` decorators
or v1 `function.json` files, and record an existing virtual environment
and dependency manifest for the generation handoff. These are scan notes
inside the existing plan; do not add a new column to Debug Configurations.
If a dependency manager or interpreter cannot be identified, mark the
prerequisite ❓ and let the user correct the plan before approval.
