# Runtimes

> These are **common examples, not an exhaustive list**. If a service root uses a runtime
> not listed here, identify it by the language and toolchain present (e.g. `rust`, `ruby`, etc.).

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

Read `<TargetFramework>` from the `.csproj` to determine the runtime version (e.g. `net8.0` → `8.0`).

### Assembly Name

Derive the assembly name for the plan's Service Label:

1. If `<AssemblyName>` is set → use that value
2. Otherwise → `.csproj` filename without extension (e.g. `Functions.csproj` → `Functions`)
