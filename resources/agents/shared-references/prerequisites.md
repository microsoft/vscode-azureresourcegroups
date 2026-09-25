# Prerequisites

Detect installed developer tools and VS Code extensions; catalog common tools for building, running, and debugging Azure projects.

There are two phases:

1. **Identify required tools** — derive tools from service criteria (runtime, package manager, project type, orchestrator, etc.).
2. **Inventory what's installed** — check the user's machine; record each tool's install status and version.

---

## Phase 1: Identify required tools

Calling custom agent gathers inputs describing each project service: runtime(s), package manager(s), project type(s), Azure dependencies, orchestrator, execution mode, etc. Input acquisition is agent-defined; gather them before this phase.

Use inputs to identify required tools. Phase 1 always derives **both** Run and Debug sets. Calling custom agent chooses which set(s) to surface—e.g. Run only or both—per workflow.

Catalogs are illustrative, not exhaustive. Map every stack/runtime or Azure dependency to its build or run tool and appropriate set.

In output table, record **which planned service(s)** require each tool (e.g. `api`, `worker`). Use `*` for global toolchain shared by all services, or list each service. For container runtime/Compose provider (Docker or Podman, plus Docker Compose or Podman Compose), list services whose Azure dependencies their emulators replace, not `*`.

### Run Tools

Dependencies required for local runs; a missing run tool prevents startup. Examples are illustrative, not exhaustive:

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

Local debugging needs three independent entry types; evaluate all every time: container tooling (runtime—**Docker or Podman**—plus Compose provider) for Azure-dependency emulators; Chromium browser (Chrome or Edge) for frontend types debugging in browser; and each matching VS Code debug-integration extension below. Extensions provide task types, problem matchers, and launch integration; required even without Azure emulator dependencies and when matching CLI/runtime already appears in Run group.

This table is the **authoritative list**: include every row whose trigger matches. Maintainers must add new debug tools or extensions here. Some project types require a specific VS Code extension (e.g. Azure Functions needs the Functions extension for its `func` task type and problem matchers); use this table, not memory.

Prefer listed debug tools. Never list VS Code itself; plan already runs inside it. Never list emulator VS Code extension (e.g. an "Azurite Extension"); emulators run as containers via chosen runtime (Docker or Podman) + Compose provider, not extensions.

| Tool / Extension | Category | Trigger When | Detect with |
|------------------|----------|----------------------|-------------|
| Docker _or_ Podman | Container runtime | Project has Azure dependencies that run as local emulators | `docker --version` **or** `podman --version` |
| Docker Compose _or_ Podman Compose | Compose provider | Orchestrating emulators | `docker compose version` **or** `podman compose version` |
| Chrome or Edge | Browser | Project has a frontend/SPA project type that debugs in a browser | See Browser detection in Phase 2 — detect Chrome/Edge; if neither is found, fall back by OS |
| `ms-azuretools.vscode-azurefunctions` | VS Code extension | Has an Azure Functions service | extensions filesystem check (Phase 2); installed (`✅`) if found, otherwise unknown (`❓`) |

**Container runtime is Docker _or_ Podman—pick one, never both.** Docker Desktop and Podman are interchangeable emulator-container engines; generated `docker-compose.yml` is identical. Detect both (see [Container runtime detection](#container-runtime-detection) in Phase 2), then emit rows for **one** chosen runtime: Docker + Docker Compose, Podman + Podman Compose, or Podman via Docker's socket—see below. **Prefer ready Podman engine**: native Podman when `podman` CLI ready, even if Docker also ready; or Podman-in-Docker-compatibility mode when `docker` CLI is Podman-backed; unless user explicitly asks Docker. Fall back to Docker when Podman isn't ready; default Docker only when neither confirmed. Record chosen runtime + Compose command in plan Orchestrator table so generation emits matching task commands.

For frontend projects debugging in browser, include one browser row (Chrome or Edge). Put **specific browser chosen** in row name; generate phase uses it for frontend debug adapter `type` (`chrome` for Chrome, `msedge` for Edge). See Browser detection in Phase 2.

Always emit a Debug row for every VS Code extension matching a present project type. Run Phase 2 filesystem check: folder found means installed (`✅`); otherwise unknown (`❓`). Never drop an unfound row or treat a Run tool as coverage. An Azure Functions project needs a `ms-azuretools.vscode-azurefunctions` row even when Azure Functions Core Tools is under Run; CLI and extension are separate prerequisites.

---

## Phase 2: Inventory what's installed

Detect every needed tool; record install state and version per details below.

Every prerequisite resolves to exactly **two** states:

- **installed (`✅`)** — detection found the tool via returned version or existing app/extension folder. Record available version.
- **unknown (`❓`)** — detection found nothing. This does **not** prove absence: version managers or restricted/sandboxed shells can hide installed tools, and extension/Compose lookups can fail silently. Failed probes are inconclusive. `❓` tells users to verify installation and, for CLI tools, run a recheck.

No "not-installed" state exists. Never mark prerequisites `❌`; anything unconfirmed is `❓`.

Re-run inventory when building from scratch, regenerating the whole plan, or changing the tool set (runtime edit or added/removed service). Do **not** re-run for partial regeneration that leaves tools unchanged unless user requests a recheck. Never carry stale results across full rebuilds.

### Shell environment caveats

Agent `bash` probes often use a **non-interactive or sandboxed** shell without user startup files (`~/.zshrc`, `~/.bashrc`, `~/.config/fish/config.fish`, …). Version managers—fnm, nvm, asdf, mise, or Volta—may expose Node.js, Python, and other runtimes by adding shims to PATH there, hiding installed tools from the first probe.

Do **not** source another shell's rc file from bash; shell-specific syntax may fail. Retry through the initialized user default shell (see CLI tool detection). Because failure cannot distinguish absence from environment hiding, record `❓`, never `❌`.

On **Windows**, registry system/user PATH usually exposes tools installed with `winget`, `choco`, etc. in every shell without profile sourcing.

---

### CLI tool detection

Probe each CLI tool (Node.js, npm, pnpm, yarn, Python, pip, `dotnet`, `func`, and all other catalog CLIs) in two stages; **stop at first success**. Any returned version means `✅` plus version. Only both failures mean `❓`.

**Stage 1 — direct check.** Run catalog version command in current shell.

```bash
# macOS/Linux — direct probe in the current and likely non-interactive shell.
# `command -v <tool>` gates the version call so we only run it when the tool is
# actually on PATH, and it keeps a shell greeting or "not found" message from
# being mistaken for a version. `2>&1` merges stderr because some tools print
# their version there (e.g. older Python and Java).
command -v node >/dev/null 2>&1 && echo "node:" && node --version 2>&1
```

For each tool, substitute its name in all three spots: `command -v <tool>` gate, `echo "<tool>:"` label, and version command. Use its catalog version flag (`--version`, `-v`, `-V`, `version`).

**Stage 2 — retry through the user's initialized shell.** If Stage 1 returns nothing, rerun the *same* version command in configured default shell (`$SHELL`) as **login + interactive**. One invocation uses `-l` and `-i` to source startup files, then `-c '<command>'` to run inside that environment; do not start shell and send a second command. Startup exposes version-manager shims (fnm, nvm, asdf, mise, Volta) on PATH.

For reliability, first require executable `$SHELL`; gate version command with `command -v <tool>` so greetings or banners cannot mimic versions. Wrap output in unique markers and read only between them.

```bash
# macOS/Linux — retry through the user's own default shell, initialized.
# Pass -l -i -c as SEPARATE flags: some shells like fish reject the bundled `-lic` form.
# `command -v` gates the version command, and 2>&1 keeps versions printed to
# stderr. A login+interactive shell sources the user's startup files, which can
# emit greetings/banners/MOTD to stdout; the echo markers fence the real version
# output so we parse only the line between them and ignore that noise. They stay
# portable across bash, zsh, fish, etc.
[ -n "$SHELL" ] && [ -x "$SHELL" ] && \
  "$SHELL" -l -i -c 'command -v node >/dev/null 2>&1 && echo __COR_START__ && node --version 2>&1 && echo __COR_END__'
```

For Python, swap the tool name in the `command -v` gate and version command; keep markers unchanged:

```bash
[ -n "$SHELL" ] && [ -x "$SHELL" ] && \
  "$SHELL" -l -i -c 'command -v python >/dev/null 2>&1 && echo __COR_START__ && python --version 2>&1 && echo __COR_END__'
```

Run Stage 2 for every Stage 1 CLI failure. On **Windows**, registry PATH normally makes Stage 1 sufficient:

```powershell
# Windows PowerShell
Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
```

For any `❓` CLI result, tell user it was unconfirmed and request a recheck. Recheck uses host default shell and may find version-manager runtimes hidden from initial sandboxed scan; confirmation changes it to `✅`.

---

### Container runtime detection

Only when the project has Azure dependencies that run as local emulators. The emulators run in containers, so the plan needs exactly one container runtime and its Compose provider. **Docker and Podman are interchangeable here** — detect both, then record the one the plan will use.

Follow the same two states as every other prerequisite: **installed (`✅`)** when a probe positively confirms the runtime is present *and ready*, **unknown (`❓`)** otherwise. Never `❌`.

**Step 1 — detect each engine's CLI and Compose provider.** Use the same first-success, two-stage shell approach as CLI tool detection (a version-manager or sandboxed shell can hide an installed tool):

```bash
# Docker
command -v docker >/dev/null 2>&1 && echo "docker:" && docker --version 2>&1
command -v docker >/dev/null 2>&1 && echo "docker compose:" && docker compose version 2>&1

# Podman
command -v podman >/dev/null 2>&1 && echo "podman:" && podman --version 2>&1
command -v podman >/dev/null 2>&1 && echo "podman compose:" && podman compose version 2>&1
```

```powershell
# Windows
Get-Command docker -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
Get-Command podman -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
```

> **`podman compose` needs an external Compose provider.** `podman compose` is a thin wrapper that shells out to `docker-compose` or `podman-compose`; installing the `podman` CLI alone does not guarantee Compose works. Treat Podman's Compose provider as `✅` only when `podman compose version` returns a version.

**Step 2 — confirm the engine is ready, not just installed.** A CLI on PATH is not the same as a running engine.

- **Linux:** the runtime is usually ready once the CLI resolves; a quick `docker info` / `podman info` confirms the daemon/socket is reachable.
- **Windows and macOS:** both engines run containers inside a Linux VM. Docker Desktop must be running; Podman needs a **Podman machine** that exists and is started. Probe it without mutating anything:

  ```bash
  # Is a Podman machine defined and running? (never init/start it here — see the plan phase)
  podman machine list --format '{{.Name}} {{.Running}}' 2>&1
  ```

  If no machine exists, or the machine is stopped, record Podman as `❓` and note in the plan that the user must run `podman machine init` / `podman machine start` before F5. **Do not create or start a Podman machine during detection** — that is a slow, stateful action the user should approve (handled in the generation preflight).

**Step 2b — detect Podman running behind Docker's socket (Docker-compatibility mode).** Podman Desktop can expose a **Docker-compatible socket** so plain `docker` / `docker compose` commands actually drive the **Podman** engine. When you detected a working `docker` CLI in Step 1, check which engine actually answers before labeling it Docker:

```bash
# The Docker CLI reports its backing server engine here.
docker info --format '{{.ServerVersion}}' 2>&1        # a Podman backend shows e.g. "5.x.y" with Podman in the full `docker info`
docker version --format '{{.Server.Version}}' 2>&1
```

If the Docker CLI's server identifies as **Podman** (the full `docker info` / `docker version` names Podman, or `podman` is the only engine installed yet `docker` resolves), the machine is running **Podman in Docker-compatibility mode**: the engine is Podman but the Compose command stays `docker compose`. Record this as its own runtime (see Step 3, option for Docker-compat).

**Step 3 — choose the runtime and record it.**

1. If an existing `docker-compose.yml`/`compose.yaml` and project tooling already imply a runtime, keep it (don't override a deliberate existing setup).
2. **Prefer the Podman engine whenever it's ready.**
   - If **native Podman** is `✅` (the `podman` CLI is ready — engine reachable, machine running on Win/mac, `podman compose` provider present), select **Podman** with the `podman compose` command — even if Docker is also ready — unless the user explicitly asked for Docker.
   - Else if the `docker` CLI is ready **but backed by Podman** (Step 2b), select **Podman (Docker-compatible)**: the engine is Podman, but the Compose command stays **`docker compose`**. Prefer this over plain Docker too, since the engine is still Podman.
3. Otherwise, if Docker is `✅` (backed by the real Docker engine), select **Docker** with `docker compose`.
4. If **neither** can be confirmed, default the plan to **Docker**, record the container runtime + Compose provider as `❓`, and surface the action-required callout so the user installs/starts one before approving.

Record the choice in the plan's Orchestrator table so the generation phase emits the matching Compose command:

| Selection | Container Runtime cell | Compose Command cell |
|-----------|------------------------|----------------------|
| Native Podman | `Podman` | `podman compose` |
| Podman via Docker socket | `Podman (Docker-compatible)` | `docker compose` |
| Docker | `Docker` | `docker compose` |

This preference is the same in autopilot: autopilot selects the Podman engine (native, else Docker-compatible) when it's ready and falls back to Docker, with no chat prompt.

Emit prerequisite rows for the **selected** runtime only (Docker + Docker Compose, or Podman + Podman Compose), and record the same choice — plus its Compose command (`docker compose` or `podman compose`) — in the plan's Orchestrator table so the generation phase emits matching task commands.

---

### VS Code extension detection

Check extension filesystems; do **NOT** use `code --list-extensions` because it launches another VS Code instance. Users may have VS Code, VS Code Insiders, or both; always check all locations with `find`, more reliably than piping `ls` through `grep`:

```bash
# macOS/Linux
find ~/.vscode/extensions ~/.vscode-insiders/extensions -maxdepth 1 -name "<extension-id-prefix>*" 2>/dev/null
```

```powershell
# Windows
Get-ChildItem "$env:USERPROFILE\.vscode\extensions", "$env:USERPROFILE\.vscode-insiders\extensions" -Filter "<extension-id-prefix>*" -ErrorAction SilentlyContinue
```

Check extensions from Phase 1's authoritative **VS Code debug-integration extensions** table. Folder found means installed (`✅`); nothing means unknown (`❓`) because restricted shells can hide installed extensions.

---

### Browser detection

Apply only to frontend/SPA project types debugging in a browser. Detect installed Chromium-based Chrome or Edge and record **that** browser. Choice sets generated debug config `type`: Chrome → `chrome`, Edge → `msedge`.

Detect both, then choose in this order:

1. Installed **Chrome**: choose Chrome; record installed (`✅`) and available version.
2. Otherwise, installed **Edge**: choose Edge; record installed (`✅`) and available version.
3. If **neither** is detected, choose OS fallback and record unknown (`❓`):
   - **Windows** → Edge (`msedge`). Edge ships with Windows and normally appears in step 2, so fallback is rare.
   - **macOS / Linux** → Chrome (`chrome`).

```bash
# macOS — installed if the app bundle exists
ls -d "/Applications/Google Chrome.app" 2>/dev/null   # Chrome
ls -d "/Applications/Microsoft Edge.app" 2>/dev/null  # Edge
```

```bash
# Linux — installed if any binary resolves
which google-chrome google-chrome-stable chromium chromium-browser 2>/dev/null   # Chrome / Chromium
which microsoft-edge microsoft-edge-stable 2>/dev/null                            # Edge
```

```powershell
# Windows — installed if any path exists
Test-Path "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"  # Chrome
Test-Path "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"  # Edge
```

---

## Never author install links

Do **not** add an `Install` column or emit tool install links or URLs in tables, browser fallback, or elsewhere. Plan webviews append deterministic Install links from a built-in tool-name catalog; authored links are ignored and could expose untrusted model-authored URLs. Name tools exactly as catalog labels so webview resolves links.
