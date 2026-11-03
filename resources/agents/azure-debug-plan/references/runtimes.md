# Runtimes

> **Common examples, not exhaustive.** For unlisted runtime, identify from present
> language and toolchain (e.g. `rust`, `ruby`, etc.).

## Detection Table

| Detection Signals | Runtime | Version Source |
|-------------------|---------|---------------|
| `package.json` + `tsconfig.json` | **node-ts** | `engines.node` / `.nvmrc` / `.node-version` |
| `package.json` (no `tsconfig.json`) | **node-js** | Same |
| `*.csproj` | **dotnet** | `<TargetFramework>` element (e.g. `net8.0` → `8.0`) |
| `requirements.txt`, `pyproject.toml`, or `Pipfile` | **python** | `.python-version` / `pyproject.toml` `requires-python` |
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

---

## python

Read `.python-version`, `pyproject.toml` `requires-python`, lockfiles, the integration hand-off, and existing workspace interpreter/Functions settings. Resolve compatibility through [prerequisites.md](../../shared-references/prerequisites.md#python-interpreter-and-environment-compatibility); a manifest constraint is not a detected installation.

Record the service root, entry point (`function_app.py` for Python v2 Functions), production/dev requirements files, package manager, interpreter version/path, and venv path for generation. Detect service-local `.venv` first but preserve a compatible existing workspace-root or manager-owned venv. pip, compile, tests, and migrations must all use that interpreter.
