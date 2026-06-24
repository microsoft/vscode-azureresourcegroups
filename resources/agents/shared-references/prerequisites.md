# Prerequisites

Instructions for detecting which developer tools and VS Code extensions a user has installed, plus a catalog of the tools commonly required to build, run, and debug Azure projects.

There are two phases:

1. **Identify required tools** — derive the required tool set from a set of service criteria (runtime, package manager, project type, orchestrator, etc.).
2. **Inventory what's installed** — check the user's machine to see which of those tools are already installed and ready, recording the install status and version.

---

## Phase 1: Identify required tools

The calling custom agent is responsible for gathering its inputs during this phase — the inputs that describe each service of the project (runtime(s), package manager(s), project type(s), Azure dependencies, orchestrator, execution mode, and so on). How those inputs are obtained is up to the agent, but the agent should come with those in hand.

Those inputs are then used to identify which tools the user should have installed. Phase 1 always derives **both** sets — Run and Debug. The calling custom agent then decides which set(s) to surface — e.g. show only Run, or both — according to its workflow.

These catalogs are not meant to be exhaustive, but illustrative - map any stack/runtime or Azure dependency to the tool that builds or runs it, and assign it to the set that fits.

When the calling agent writes its output table, it should also record **which planned service(s)** require each tool (e.g. `api`, `worker`), using `*` for global toolchain shared by all services (or listing each service explicitly). For a container runtime or orchestrator (Docker, Docker Compose), list the service(s) whose Azure dependencies its emulators stand in for, rather than `*`.

### Run Tools

Dependencies that are required to run the project locally. If a run tool is missing the project cannot start.  These are a list of illustrative examples, they are not exhaustive:

| Tool | Category | Detect with | Needed for |
|------|----------|-------------|------------|
| Node.js | Runtime | `node --version` | node-ts / node-js stacks |
| npm | Package manager | `npm --version` | Node dependency management |
| pnpm | Package manager | `pnpm --version` | Node dependency management (pnpm projects) |
| yarn | Package manager | `yarn --version` | Node dependency management (yarn projects) |
| Python | Runtime | `python --version` (or `python3 --version`) | python stacks |
| pip | Package manager | `pip --version` (or `pip3 --version`) | Python dependency management |
| .NET SDK | Runtime / SDK | `dotnet --version` | dotnet stacks |
| Azure Functions Core Tools | Runtime | `func --version` | Azure Functions backends |

### Debug Tools

Tooling needed to debug the project locally (not just to run it through the terminal): container tooling for Azure-dependency emulators, plus the VS Code extensions that provide debug integration for each project type.

This table is the **authoritative list** — include every row whose trigger matches the project, and maintainers must add any new debug tool or extension here so it is considered. Some project types require a specific VS Code extension for the debug experience (e.g. Azure Functions needs the Functions extension for its `func` task
type and problem matchers), so do not infer these from memory — take them from this table.

Only the rows in this table are valid prerequisites. Do not add tools that aren't listed here. In particular, never list VS Code itself — the plan is already running inside VS Code, so it is always present — and never list a VS Code extension for an emulator (e.g. an "Azurite Extension"). Emulators run as containers via Docker and Docker Compose, not as extensions; the only debug extensions are the project-type debug-integration extensions in the table below.

| Tool / Extension | Category | Trigger / Needed for | Detect with |
|------------------|----------|----------------------|-------------|
| Docker | Container runtime | Project has Azure dependencies that run as local emulators | `docker --version` |
| Docker Compose | Orchestrator | Orchestrating emulators | `docker compose version` |
| `ms-azuretools.vscode-azurefunctions` | VS Code extension | Azure Functions service | extensions filesystem check (Phase 2) |

Always include the any matching VS Code extension when they match a given service; for example, the Azure Functions extension when building an Azure Functions project.

---

## Phase 2: Inventory what's installed

For each needed tool, run its detection and record whether it is installed and at what version. Mind any details in the sections below.

Re-run this inventory every time the calling agent (re)builds its plan or the tool set changes — never carry over a stale result or leave a tool's status unknown. Every tool must resolve to installed or not-installed from an actual scan.

### Shell environment caveats

Subagent shells may run as **non-interactive** processes. On macOS/Linux, non-interactive shells skip user startup files like `~/.bashrc`, `~/.zshrc`, etc. Since some users configure PATH additions in these interactive-only rc files, those paths are invisible to subagents. **Before running any version checks**, detect the user's default shell via `$SHELL` and source any relevant rc files to inherit PATH additions:

```bash
# macOS / Linux — source the user's rc file silently based on their default shell
case "$SHELL" in
  */bash) [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc" 2>/dev/null >/dev/null ;;
  */zsh)  [ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null >/dev/null ;;
  */fish) ;; # fish uses incompatible syntax; rely on fallback PATH approach below
  *)      [ -f "$HOME/.profile" ] && source "$HOME/.profile" 2>/dev/null >/dev/null ;;
esac
```

On **Windows**, PATH is set at the system/user level via the Windows registry. Tools installed via `winget`, `choco`, etc. are available in all shell contexts without sourcing any profile — the missing-PATH problem is primarily a macOS/Linux issue.

---

### CLI tool detection

Run the version command from the catalog. When a tool check fails, use `which`/`where` with fallback paths before reporting it as missing:

```bash
# macOS/Linux
which func 2>/dev/null || \
  find /opt/homebrew/bin /usr/local/bin ~/.npm-global/bin -name "func" 2>/dev/null | head -1
```

```powershell
# Windows PowerShell
Get-Command func -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
```

---

### VS Code extension detection

Check the extensions filesystem — do **NOT** use `code --list-extensions` (it launches a new VS Code instance). Users may have VS Code, VS Code Insiders, or both — always check all possible locations using `find` (more reliable than piping `ls` through `grep`):

```bash
# macOS/Linux
find ~/.vscode/extensions ~/.vscode-insiders/extensions -maxdepth 1 -name "<extension-id-prefix>*" 2>/dev/null
```

```powershell
# Windows
Get-ChildItem "$env:USERPROFILE\.vscode\extensions", "$env:USERPROFILE\.vscode-insiders\extensions" -Filter "<extension-id-prefix>*" -ErrorAction SilentlyContinue
```

The extensions to check come from the **VS Code debug-integration extensions** table in Phase 1 — that table is the authoritative list. Detect each one with the extensions filesystem check above.
