# .NET / C# — Debug & Build Configuration

> Covers **.NET** projects. Project-type-specific hosting (Functions, App Service, etc.) is defined in `project-types/{type}.md` — this file covers the .NET runtime layer only.

## Prerequisites

| Tool | Detection Command | Required For | Install Link |
|------|-------------------|-------------|-------------|
| .NET SDK | `dotnet --version` | Build and run .NET projects | [dotnet.microsoft.com](https://dotnet.microsoft.com/download) |
| C# extension | VS Code extension `ms-dotnettools.csharp` installed | Contributes the `coreclr` debugger type required for F5 debugging | [Marketplace](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.csharp) |

---

## Debugger Properties

<!-- Generic debug properties for this runtime.
     See project-types/{type}.md § Runtime Wiring for how these combine with the host command.
     See generate.md § Source Ownership for how runtime and project-type refs compose. -->

| Property | Value | Notes |
|----------|-------|-------|
| Debug protocol | `CoreCLR DAP` | .NET Core / .NET 5+ debug adapter protocol |
| VS Code debugger type | `coreclr` | Contributed by the C# extension (`ms-dotnettools.csharp`) |
| Request mode | `attach` | VS Code attaches to a running .NET process by `processName` |
| Base debug port | — | CoreCLR attach uses `processName`, not a port |

### VS Code Problem Matchers

| Task | Watch Problem Matcher | Build Problem Matcher |
|------|----------------------|----------------------|
| `dotnet build` | — | `$msCompile` |

---

## processName Determination

The `coreclr` debugger (request: `attach`) matches `processName` **literally** against the OS process list. Getting this wrong means F5 silently fails.

### Cross-Platform Rules

| Platform | Process name | Example |
|----------|-------------|---------|
| Windows | `{AssemblyName}.exe` | `Scrapbook.Api.exe` |
| macOS / Linux | `{AssemblyName}` (no extension) | `Scrapbook.Api` |

> ⛔ **Windows requires the `.exe` suffix.** Writing `"Scrapbook.Api"` instead of `"Scrapbook.Api.exe"` produces:
>
> ```
> No process with the specified name is currently running.
> ```

### Deriving `AssemblyName`

The process name is derived from the project's `.csproj`:

1. If `<AssemblyName>` is defined, use that value
2. Otherwise, the `.csproj` filename without extension (e.g., `Functions.csproj` → `Functions`)
3. The `.csproj` **MUST** have `<OutputType>Exe</OutputType>` — otherwise no executable is produced and there's no target to debug

**Verify before writing `launch.json`:** after `dotnet build`, confirm the executable exists at `{projectDir}/bin/Debug/{tfm}/{AssemblyName}[.exe]`.

> ❌ **Do NOT use `${command:pickProcess}` or `${command:azureFunctions.pickProcess}`** — both pop a blocking dialog every F5. Use literal `processName`.

---

## Build Chain

Tasks owned by this runtime: build. The startup task and its dependency wiring are provided by the project type's Runtime Wiring table — not this file.

> **Task label scoping:** All task labels MUST be prefixed with the service ID (e.g., `functions-api: dotnet build`). See [generate.md § Service ID Derivation](../generate.md).

Chain shape (startup task comes from the project type):

```
"{service-id}: {startup task}"              ← from project-types/{type}.md Runtime Wiring
       ├── dependsOn: "{service-id}: dotnet build"   ← this file
       └── dependsOn: "Start Emulators"     ← only when emulators are required
```

### Build Commands

| Step | Task Label | Command | Purpose | Background? |
|------|-----------|---------|---------|------------|
| build | `{service-id}: dotnet build` | `dotnet build {path-to-csproj} --configuration Debug` | Restore + compile | No |

```json
{
  "label": "{service-id}: dotnet build",
  "type": "process",
  "command": "dotnet",
  "args": [
    "build",
    "${workspaceFolder}/{path-to-csproj}",
    "--configuration",
    "Debug"
  ],
  "problemMatcher": "$msCompile",
  "group": "build",
  "runOptions": { "instanceLimit": 1, "instancePolicy": "silent" }
}
```

> .NET does not have a watch-based incremental compile step in the debug chain (unlike TypeScript's `tsc --watch`). Each F5 re-runs `dotnet build`.

See [generate.md](../generate.md) § Task `runOptions` Rules for how these build steps are rendered into VS Code task configuration.

---

## Convenience Scripts

The plan's Convenience Scripts table specifies WHICH scripts to generate. This section covers HOW to register them for .NET projects.

Because .NET projects do not have a built-in script runner equivalent to `npm run`, convenience scripts live as standalone scripts under `scripts/`.

**Script runner:** Scripts in `scripts/` directory
**Run command pattern:** Platform-dependent (see below)

### Script Format

Generate scripts appropriate for the user's platform:

| Platform | File extension | Shebang / header | Make executable |
|----------|---------------|-------------------|-----------------|
| macOS / Linux | `.sh` | `#!/bin/bash` | `chmod +x` |
| Windows | `.ps1` | — | — (PowerShell scripts run directly) |

> When the platform is ambiguous, generate `.sh` scripts — they also work on Windows via Git Bash or WSL.

### Common Script Implementations

Use these implementations when building scripts from the plan:

| Script Purpose | Typical Command | Notes |
|---------------|-----------------|-------|
| Start emulators | `docker compose up -d` | Idempotent — safe to re-run |
| Stop emulators | `docker compose down` | Stops and removes containers |
| Clean emulator data | Stop containers and remove data directories | `{data-dirs}` = `./.{name}` directories derived from `docker-compose.yml` `volumes:` mounts. Use platform-appropriate removal (e.g., `rm -rf` on macOS/Linux, `Remove-Item -Recurse` on Windows) |
| Run migrations | `{migration tool CLI command}` | See [migrations.md](../migrations.md) for how to determine the command |

---

## VS Code Extension Recommendations (`.vscode/extensions.json`)

<!-- Extensions required by this runtime. Aggregated with project-type extensions into .vscode/extensions.json by generate.md. -->

| Extension ID | Why Required |
|--------------|-------------|
| `ms-dotnettools.csharp` | Contributes the `"type": "coreclr"` debugger for .NET attach/launch |
| `ms-dotnettools.csdevkit` | C# Dev Kit — adds Solution Explorer, test discovery, and enhanced debugging experience |

> Project-type-specific extensions (e.g., `ms-azuretools.vscode-azurefunctions` for Functions) are listed in `project-types/{type}.md`.

---

## VS Code Workspace Settings (`.vscode/settings.json`)

<!-- Settings contributed by this runtime. Aggregated with project-type settings into .vscode/settings.json by generate.md. -->

| Setting | Value | Why |
|---------|-------|-----|
| `files.exclude: **/bin` | `true` | Hide .NET build output from explorer |
| `files.exclude: **/obj` | `true` | Hide .NET intermediate build files from explorer |

> These exclusions reduce workspace noise. They are deep-merged with any existing `files.exclude` entries — see [generate.md § VS Code Workspace Settings](../generate.md).

---

## Checklist — .NET Runtime Validation

> ⛔ **MANDATORY — runs during Phase 3 validation after all artifacts are generated.** You MUST verify every item below. Do NOT skip, assume, or approximate results.

After generating VS Code configuration, verify the following were produced correctly:

### Post-Generation Checks

1. ✅ `dotnet build` task exists in `tasks.json` with `$msCompile` problem matcher
2. ✅ `processName` in `launch.json` matches the `AssemblyName` derived from `.csproj` (platform-appropriate — see § processName Determination)
3. ✅ `launch.json` uses `"type": "coreclr"` with `"request": "attach"`
4. ✅ `.vscode/extensions.json` includes `ms-dotnettools.csharp` and `ms-dotnettools.csdevkit`

### Live Validation Checks

These checks run during Phase 3 validation ([validation.md](../validation.md) Step 7), after the ready signal is observed:

1. ✅ Verify the target process exists for attachment — the `processName` in `launch.json` must match a running OS process:
   - **Windows PowerShell:** `Get-Process -Name "<processName without .exe>" -ErrorAction SilentlyContinue` → must return a process
   - **macOS/Linux:** `pgrep -x "<processName>"` → must return a PID
2. ✅ On Windows, confirm `processName` includes the `.exe` suffix (e.g., `"Scrapbook.Api.exe"`, NOT `"Scrapbook.Api"`)
3. ✅ If process check fails, fix `launch.json` before marking the config ✅

> If the process is not found, the F5 attach WILL fail with: `"No process with the specified name is currently running"`
