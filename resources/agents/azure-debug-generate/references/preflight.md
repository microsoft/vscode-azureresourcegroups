# Pre-Flight Checks

Verify the plan exists and environment is ready before proceeding onwards to generating files.

## Container Runtime Readiness Check

Read the container runtime from the plan's Orchestrator table (**Docker**, **Podman**, or **Podman (Docker-compatible)**) and confirm the engine is actually running before you generate or validate anything. A CLI on PATH is not the same as a running engine.

- **Docker** — confirm the daemon is reachable (`docker info`). If it errors, tell the user to start Docker Desktop / the Docker service and wait, then retry.
- **Podman (Docker-compatible)** — the plan runs the Podman engine through its Docker-compatible socket, and the generated tasks use `docker compose`. Confirm the socket answers with `docker info` (it will report the Podman server). If `docker info` errors, the Docker-compatible socket isn't up: tell the user to enable Docker compatibility in Podman Desktop and ensure the **Podman machine** is started (same machine check as below), then retry.
- **Podman** — confirm the engine is reachable (`podman info`). On **Windows and macOS** this needs a running **Podman machine**:

  ```bash
  podman machine list --format '{{.Name}} {{.Running}}'
  ```

  - If a machine exists but is **stopped**, ask the user before starting it (starting a VM is a stateful, resource-consuming action):

    ```
    ask_user(
      question: "Your Podman machine \"podman-machine-default\" is stopped. Start it so the emulators can run?",
      choices: [
        "Yes, start the Podman machine",
        "No, I'll start it myself"
      ]
    )
    ```

    On approval, run `podman machine start` and wait for it to report ready.
  - If **no machine exists**, do NOT silently `podman machine init` — tell the user to run `podman machine init && podman machine start` (a one-time, multi-minute setup) and re-run once it is ready.

> ⛔ **NEVER switch the plan's container runtime on your own — not at readiness, not during generation, not during validation.** The runtime in the Orchestrator table was chosen (and, when the user asked for a specific engine, chosen *by them*). If the selected engine fails at **any** point — the engine won't start, a container won't come up, ports don't forward to the host, a volume/permission error, a health check never passes — **STOP and surface the blocker to the user with `ask_user`**, describing the failure and the options (fix the engine, or explicitly switch to the other engine). Do **not** silently rewrite the Orchestrator row, the `Start Emulators` task, or the convenience scripts to a different engine and continue. Silently falling back — e.g. from a user-requested Podman to Docker because Podman had a networking or bind-mount issue — is a **failure of this agent**, even if the resulting app works: the user asked for Podman and must decide, not discover after the fact that Docker ran everything.
>
> When you do surface a runtime blocker, prefer offering the **fix** first (many Podman-on-Windows issues are config, not dead ends — e.g. use the WSL machine provider for host port forwarding; database emulators must use a named volume, not a workspace bind mount, so `initdb` can `chown` its data dir). Only switch engines if the user explicitly chooses to.

## Stale Data Directory Check

Before generating any files, check for leftover emulator state from a previous run — both **workspace data directories** (bind-mounted emulators such as Azurite's `.azurite/`, `.cosmos/`, `.servicebus/`) and **named volumes** (database emulators such as Postgres's `postgres_data`; see [emulators/postgres.md](emulators/postgres.md)). Stale state can cause container startup failures — for example, PostgreSQL's `initdb` will refuse to initialize if the data directory (the `postgres_data` volume) already contains files from an incompatible or partially-initialized cluster.

- **Bind-mounted data directories:** list them with `ls`/`Get-ChildItem` in the workspace.
- **Named volumes:** list them with `docker compose ls` / `docker volume ls` (or the `podman` equivalents) — a project-scoped `*_postgres_data` volume from a prior run is the database equivalent of a stale directory.

If any stale state is found:

1. **List all found directories and named volumes** with their sizes.
2. **Ask the user how to proceed** using `ask_user`:

```
ask_user(
  question: "Leftover emulator state was found from a previous run:\n\n- .azurite/ (12 MB, workspace directory)\n- postgres_data (45 MB, named volume)\n\nThese can cause container startup failures. How would you like to handle this?",
  choices: [
    "Delete them and start fresh (recommended)",
    "Keep them — I want to preserve the existing data"
  ]
)
```

3. **If the user chooses to delete** — Remove bind-mounted directories with platform-appropriate removal (`rm -rf` on macOS/Linux, `Remove-Item -Recurse -Force` on Windows), and remove named volumes with `docker compose down -v` / `podman compose down -v` (or `docker volume rm <project>_postgres_data`), before proceeding with generation.
4. **If the user wants to keep them** — Proceed, but warn that containers may fail to start. If they do fail, offer to clean up at that point.
5. **Never delete data directories or volumes silently** — Always confirm with the user first.

---

## Port Conflict Check

Before generating any files, scan all ports required by the planned emulators (e.g. `lsof -i -P -n`). For each occupied port, identify the process name and PID.

If any conflicts are found:

1. **List all conflicts clearly** — port number, process name, PID.
2. **Ask the user how to proceed** using `ask_user`:

```
ask_user(
  question: "The following ports are already in use on your machine:\n\n- Port 5432 → postgres (PID 1234)\n\nThese ports are needed by the planned emulators. How would you like to handle this?",
  choices: [
    "Help me remap the conflicting ports to alternatives",
    "I'll handle it myself — proceed with the plan as-is"
  ]
)
```

3. **If the user wants help remapping** — Propose alternative port numbers, update all references in the plan and project files (docker-compose service ports, connection strings, convenience scripts, VS Code debug config), then resume generation.
4. **If the user will handle it themselves** — Proceed with generation using the original ports.
5. **Never remap ports or modify config silently** — Always confirm with the user before making changes.
