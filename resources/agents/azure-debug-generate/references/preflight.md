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

Never switch the plan's runtime silently. If the selected engine cannot be made ready, stop and surface the blocker rather than falling back to the other engine on your own.

## Stale Data Directory Check

Before generating any files, check for leftover emulator data directories from a previous run (e.g. `.postgres/`, `.azurite/`, `.cosmos/`, `.servicebus/`). These directories can cause container startup failures — for example, PostgreSQL's `initdb` will refuse to initialize if `/var/lib/postgresql/data` (mounted from `.postgres/`) already contains files from an incompatible or partially-initialized cluster.

If any stale directories are found:

1. **List all found directories** with their sizes.
2. **Ask the user how to proceed** using `ask_user`:

```
ask_user(
  question: "The following emulator data directories were found from a previous run:\n\n- .postgres/ (45 MB)\n- .azurite/ (12 MB)\n\nThese can cause container startup failures. How would you like to handle this?",
  choices: [
    "Delete them and start fresh (recommended)",
    "Keep them — I want to preserve the existing data"
  ]
)
```

3. **If the user chooses to delete** — Remove the directories before proceeding with generation. Use platform-appropriate removal (e.g., `rm -rf` on macOS/Linux, `Remove-Item -Recurse -Force` on Windows).
4. **If the user wants to keep them** — Proceed, but warn that containers may fail to start. If they do fail, offer to clean up at that point.
5. **Never delete data directories silently** — Always confirm with the user first.

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
