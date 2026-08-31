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

When the calling agent writes its output table, it should also record **which planned service(s)** require each tool (e.g. `api`, `worker`), using `*` for global toolchain shared by all services (or listing each service explicitly). For a container runtime or Compose provider (Docker or Podman, plus Docker Compose or Podman Compose), list the service(s) whose Azure dependencies its emulators stand in for, rather than `*`.

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

Tooling needed to debug the project locally, not just to run it through the terminal. Three independent kinds of entries belong here and all must be evaluated every time: container tooling (a container runtime — **Docker or Podman** — plus its Compose provider) for any Azure-dependency emulators; a Chromium-based browser (Chrome or Edge) for any frontend project type that debugs in a browser; and the VS Code debug-integration extension for each detected project type that has a matching row in the table below. The extensions are required for the debug experience — task types, problem matchers, launch integration — even when the project has no Azure emulator dependencies and even when the matching CLI or runtime tool already appears in the Run group.

This table is the **authoritative list** — include every row whose trigger matches the project, and maintainers must add any new debug tool or extension here so it is considered. Some project types require a specific VS Code extension for the debug experience (e.g. Azure Functions needs the Functions extension for its `func` task type and problem matchers), so do not infer these from memory — take them from this table.

Prefer to use the debug tools listed here. Also, never list VS Code itself — the plan is already running inside VS Code, so it is always present — and never list a VS Code extension for an emulator (e.g. an "Azurite Extension"). Emulators will run as containers via the chosen container runtime (Docker or Podman) and its Compose provider, not as extensions.

| Tool / Extension | Category | Trigger When | Detect with |
|------------------|----------|----------------------|-------------|
| Docker _or_ Podman | Container runtime | Project has Azure dependencies that run as local emulators | `docker --version` **or** `podman --version` |
| Docker Compose _or_ Podman Compose | Compose provider | Orchestrating emulators | `docker compose version` **or** `podman compose version` |
| Chrome or Edge | Browser | Project has a frontend/SPA project type that debugs in a browser | See Browser detection in Phase 2 — detect Chrome/Edge; if neither is found, fall back by OS |
| `ms-azuretools.vscode-azurefunctions` | VS Code extension | Has an Azure Functions service | extensions filesystem check (Phase 2); installed (`✅`) if found, otherwise unknown (`❓`) |

**Container runtime is Docker _or_ Podman — pick one, don't list both.** Docker Desktop and Podman are interchangeable engines for the emulator containers, and the generated `docker-compose.yml` is identical for either. Detect both (see [Container runtime detection](#container-runtime-detection) in Phase 2), then emit prerequisite rows for the **one** the plan will use — Docker + Docker Compose, or Podman + Podman Compose. **Docker is the default** when both are ready or neither can be confirmed; only select Podman when it is the sole runtime detected as ready, or when the user asks for it. Record the chosen runtime and its Compose command in the plan's Orchestrator table so the generation phase emits matching task commands.

For a frontend project that debugs in a browser, always include a single browser row (Chrome or Edge). Record the **specific browser chosen** (Chrome or Edge) in the row name; the generate phase reads it to pick the frontend debug adapter `type` (`chrome` for Chrome, `msedge` for Edge). See Browser detection in Phase 2.

Always emit a Debug row for every VS Code extension whose project type is present. Run the Phase 2 filesystem check: if the extension folder is found, record it installed (`✅`); otherwise record it unknown (`❓`). Never drop the row just because the extension wasn't found, and never treat it as already covered by a Run tool. For example, an Azure Functions project must include a `ms-azuretools.vscode-azurefunctions` row even though Azure Functions Core Tools already appears under Run — the Core Tools CLI and the extension are separate prerequisites.

---

## Phase 2: Inventory what's installed

For each needed tool, run its detection and record whether it is installed and at what version. Mind any details in the sections below.

Every prerequisite resolves to exactly **two** states:

- **installed (`✅`)** — a detection positively found the tool (a version command returned, or an app/extension folder exists). Record the version when you have it.
- **unknown (`❓`)** — the detection did not find it. This does **not** mean the tool is absent: a version manager or a restricted/sandboxed shell can hide an installed tool, and the extension/Compose lookups fail silently in those shells. So a failed probe is inconclusive. A `❓` is informational; it just tells the user to double-check the tool is installed and, for CLI tools, to run a recheck.

There is no "not-installed" state — never mark a prerequisite with `❌`. When you cannot positively confirm a tool, it is `❓`.

Re-run this inventory whenever the calling agent builds the plan from scratch or regenerates the whole plan, and whenever the tool set itself changes (a runtime edit, or an added/removed service). Do **not** re-run it for a partial regeneration that doesn't touch the tool set — unless the user explicitly asks to recheck prerequisites. Never carry a stale result across a full rebuild.

### Shell environment caveats

The agent's `bash` probes often run in a **non-interactive or sandboxed** shell that never sourced the user's startup files (`~/.zshrc`, `~/.bashrc`, `~/.config/fish/config.fish`, …). Many users expose Node.js, Python, and other runtimes only through a shell version manager — fnm, nvm, asdf, mise, or Volta — that adds its shims to PATH from those startup files. So a tool the user has installed can be invisible to the first probe.

Do **not** work around this by sourcing another shell's rc file from bash — those files can contain shell-specific syntax bash can't parse. Instead retry through the user's own default shell, initialized (see CLI tool detection). And because a failed probe can't tell "genuinely absent" from "hidden by the environment," a tool that fails detection is `❓`, never `❌`.

On **Windows** this rarely applies: PATH is set at the system/user level via the registry, so tools installed with `winget`, `choco`, etc. are visible in every shell without sourcing a profile.

---

### CLI tool detection

Probe each CLI tool (Node.js, npm, pnpm, yarn, Python, pip, `dotnet`, `func`, and any other CLI in the catalog) in two stages, and **stop at the first success**. Record `✅` with the detected version as soon as either stage returns a version. Only if **both** stages fail do you record `❓`.

**Stage 1 — direct check.** Run the catalog's version command directly in the current shell.

```bash
# macOS/Linux — direct probe in the current and likely non-interactive shell.
# `command -v <tool>` gates the version call so we only run it when the tool is
# actually on PATH, and it keeps a shell greeting or "not found" message from
# being mistaken for a version. `2>&1` merges stderr because some tools print
# their version there (e.g. older Python and Java).
command -v node >/dev/null 2>&1 && echo "node:" && node --version 2>&1
```

Reproduce for any tool by substituting its name in all three spots — the `command -v <tool>` gate, the `echo "<tool>:"` label, and the version command. The version flag varies by tool (`--version`, `-v`, `-V`, `version`); use the one from its catalog entry.

**Stage 2 — retry through the user's initialized shell.** If Stage 1 returns nothing, re-run the *same* version command, but this time launch the user's configured default shell (`$SHELL`) as a **login + interactive** shell. This is a single invocation — the `-l` (login) and `-i` (interactive) flags make the shell source the user's startup files as part of starting up, and `-c '<command>'` runs your version command inside that now-initialized environment. There is no separate "start the shell, then send a second command" step; the initialization and the version command happen in one call. That startup is what puts a version manager's shims (fnm, nvm, asdf, mise, Volta) on PATH so the tool becomes visible.

Two guards make this reliable: check `$SHELL` is set and executable first, and gate the version command behind `command -v <tool>` so a shell greeting or startup banner can't be mistaken for a version. Wrap the real output in unique markers and read only the line between them.

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

For example, to confirm Python the same way, swap the tool name in the `command -v` gate and version command (keep the markers as-is):

```bash
[ -n "$SHELL" ] && [ -x "$SHELL" ] && \
  "$SHELL" -l -i -c 'command -v python >/dev/null 2>&1 && echo __COR_START__ && python --version 2>&1 && echo __COR_END__'
```

Run Stage 2 for every CLI tool that failed Stage 1. On **Windows**, registry-level PATH means Stage 1 is normally enough:

```powershell
# Windows PowerShell
Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
```

When the inventory produces any `❓` CLI results, tell the user those tools couldn't be confirmed and to run a recheck. The recheck retries detection through the host default shell and can confirm version-manager-provided runtimes the initial sandboxed scan couldn't see; a tool confirmed there flips to `✅`.

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

**Step 3 — choose the runtime and record it.**

1. If an existing `docker-compose.yml`/`compose.yaml` and project tooling already imply a runtime, keep it.
2. If exactly one engine is `✅` (installed **and** ready), select it.
3. If **both** are ready, select **Docker** (the default) unless the user asked for Podman.
4. If **neither** can be confirmed, default the plan to **Docker**, record the container runtime + Compose provider as `❓`, and surface the action-required callout so the user installs/starts one before approving.

Emit prerequisite rows for the **selected** runtime only (Docker + Docker Compose, or Podman + Podman Compose), and record the same choice — plus its Compose command (`docker compose` or `podman compose`) — in the plan's Orchestrator table so the generation phase emits matching task commands.

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

The extensions to check come from the **VS Code debug-integration extensions** table in Phase 1 — that table is the authoritative list. Detect each one with the extensions filesystem check above. If the check finds the extension folder, record it installed (`✅`); if it finds nothing, record it unknown (`❓`) — the scan can come up empty in restricted shells even when the extension is installed.

---

### Browser detection

Only when the project has a frontend/SPA project type that debugs in a browser. Frontend debugging launches a Chromium-based browser — Chrome or Edge — so detect which one is already installed and record **that** browser. The chosen browser drives the generated debug config `type`: Chrome → `chrome`, Edge → `msedge`.

Detect both, then choose in this order:

1. If **Chrome** is installed, choose Chrome and record it installed (`✅`) with its version if available.
2. Otherwise if **Edge** is installed, choose Edge and record it installed (`✅`) with its version if available.
3. If **neither** is detected, fall back by operating system and record the fallback as unknown (`❓`):
   - **Windows** → Edge (`msedge`). Edge ships with Windows and is normally detected as installed in step 2, so this fallback rarely triggers.
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

Do **not** add an `Install` column, and never emit an install link or URL for any tool — not in the tables, the browser fallback, or anywhere else. The plan webviews append a deterministic Install link resolved from a built-in catalog keyed on the tool name, so any link authored here is ignored, and keeping install URLs out of the plan avoids surfacing an untrusted, model-authored link to the user. Just name the tool accurately (matching the catalog labels above) so the webview can resolve its link.
