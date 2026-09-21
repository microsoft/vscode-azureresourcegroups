# Validation

Prove generated VS Code debug configuration works. Run after Phase 2 artifacts, before closing.

> ⛔ **MANDATORY.** Execute every step for each launch config. Never skip, assume, or approximate. Close only after every checklist entry has real ✅/❌.

> **Compose command comes from the plan.** Every `docker compose …` invocation below is a stand-in for the plan's Orchestrator **Compose Command** — use `docker compose` by default, or `podman compose` when the plan selected Podman. The commands (`up -d`, `ps`, `logs`, `down`) are identical across both engines.

> ⛔ **Do NOT switch the container runtime to make validation pass.** If an emulator fails to start, a port doesn't reach the host, a volume/permission error occurs, or a health check never passes on the plan's selected engine, **STOP and surface it to the user** (per [preflight.md § Container Runtime Readiness Check](preflight.md)) — offer the fix first, and only switch engines if the user explicitly chooses to. Silently rewriting the Orchestrator/tasks to the other engine and re-validating is a failure even if the app then works.

---

## Validation Algorithm

Run Steps 1–8 per **non-compound** `.vscode/launch.json` config; Step 9 per **compound**.

For each **non-compound** `.vscode/launch.json` config:

### Step 1: Resolve the Task Chain

- Read config `preLaunchTask`
- Trace full `.vscode/tasks.json` `dependsOn` chain for dependency order

### Step 2: Verify Script Dependencies

- For every resolved task, prove command executable:
   - **Package scripts** (e.g., `npm run clean`, `dotnet build`) — Matching project script or build target exists
   - **CLI tool invocations** (e.g., `rimraf`, `concurrently`) — Tool installed as project dependency
   - Missing dependency: add project dev dependency first (see [generate.md § Dependency Availability](generate.md))

### Step 3: Start Services

- Run prerequisites first (install, clean, emulators), then start `preLaunchTask` in background

### Step 4: Verify Emulators

- If `docker-compose.yml` was generated, after `docker compose up -d` (or `podman compose up -d`) verify all services started correctly:
   - **Long-running services** (database emulators, Azurite) → running and healthy
   - **One-shot services** (e.g., `db-migrate`) → exited with code 0
   - Check via `docker compose ps` and `docker compose logs <service>` (or `podman compose` equivalents)
   - On failure, diagnose, fix, and re-run until all services are healthy or exited cleanly
   - Mark config ❌ only after exhausting reasonable fix attempts

### Step 5: Confirm Ready Signal

- Watch **top-level task** stdout for ready signal from `project-types/{type}.md` § Validation Signals § Ready Signal.

### Step 6: Confirm HTTP Reachability

- After ready signal, use `curl` on **application HTTP port**, not debug port. Expected URL/status: `project-types/{type}.md` § Validation Signals § HTTP Verification.

> Use the curl template: `curl -s -o /dev/null -w "%{http_code}" <target>`

> **HTTP verification not applicable:** If project-type HTTP Verification says "N/A" or lacks anonymous/public endpoint (e.g., all routes require auth keys), skip. Ready signal alone may pass ✅; checklist must say "HTTP verification skipped: {reason}".

### Step 7: Per-Debugger-Type Checks

- Run checks for launch config `type`; see [Per-Runtime Validation Checks](#per-runtime-validation-checks). If none for debugger type, skip.

### Step 8: Cleanup

- Tear down **every** process started, not only last: top-level `preLaunchTask` + every resolved `dependsOn` task (dev servers, `func host`, watchers, emulators). Before next config, confirm app HTTP/debug ports released (e.g. `lsof -i :<port>` empty). Lingering processes make next config/compound hit "port already in use".

### Step 9: Validate the Compound Configuration

For each **compound**, run actual orchestration; never infer from individual configs.

> ⛔ **Run every compound.** Standalone-passing configs can fail together: overlapping/duplicate `dependsOn` chains may double-start services or rebind ports. Run compound orchestration; observe real result.

- **Confirm deduplicated startup graph.** Before run, verify every [multi-service.md § Deduplicated Startup Graph](multi-service.md) rule: effective graph starts each service once. Fix violations before run; never validate duplication-capable graph.

- **Run compound orchestration.** Execute compound `preLaunchTask` sequenced chain like VS Code: its `dependsOn` members in `dependsOrder: "sequence"`. Use same terminal orchestration as individuals.

- **Assert each service starts once.** Task output must show one instance per top-level task. Repeated individual `preLaunchTask` on running service MUST silently no-op via `instancePolicy: "silent"`, never spawn second process. Double instance or occupied-port grab fails; fix before proceeding.

- **Assert readiness + HTTP per service.** Confirm each member's ready signal (Step 5) and HTTP (Step 6), using same `project-types/{type}.md § Validation Signals`. Every service reaches ready; each HTTP endpoint returns expected `curl` status.

- **Record result.** Compound ✅ only when **each service started once AND reached ready AND, where applicable, passed HTTP**. Otherwise ❌ with duplicate/failure evidence.

> **Known limitation:** Agent validates orchestration/readiness through terminal; it does not attach VS Code debuggers to compound members. Assert **started exactly once + ready + reachable**.

- **Tear down compound.** Stop all started processes (member configs + full chains); confirm ports released per Step 8. Then final sweep below.

---

## Validation Signal Lookup

Each project-type reference `§ Validation Signals` defines ready signals and HTTP targets. Load service project-type file; read tables.

| Information | Where to find it |
|-------------|-----------------|
| Ready signal (stdout pattern) | `project-types/{type}.md` § Validation Signals § Ready Signal |
| HTTP verification (curl target, expected status) | `project-types/{type}.md` § Validation Signals § HTTP Verification |
| Debugger-specific checks (processName, etc.) | `runtimes/{rt}.md` § Checklist — Live Validation Checks |
| Runtime-specific details (debug port, outFiles) | `runtimes/{rt}.md` § Debugger Properties |

> **Path resolution:** Some types use subdirectories; see [generate.md § Project Type Path Resolution](generate.md).

---

## Per-Runtime Validation Checks

Runtime-specific checks after generic ready signal + HTTP verification.

> ⛔ Load and execute runtime live validation checks. Never skip or assume pass.

- Load `runtimes/{rt}.md` § Checklist; run every **Live Validation Checks** item. Runtime checklist holds debugger checks (e.g., Node.js source maps, .NET process attachment).

---

## Final Teardown — Free All Ports Before Handing Back

After all individuals + compounds, but **before** Plan Integration/status, stop everything validation started:

1. **Stop every lingering background process** started during validation: every dev server, `func host`, watcher, and task/language process across all configs and the compound. Leave nothing running.
2. **Stop every emulator you started.** If validation ran `docker compose up` (or `podman compose up`), run matching `docker compose down` / `podman compose down` or stop the specific services. Leave no Azurite, database emulator, or compose service running.
3. **Verify the ports are free again.** Confirm every generated application HTTP, debug, and emulator port is released. `lsof -i :<port>` and the plan's `docker compose ps` / `podman compose ps` must show nothing bound. Find and stop any owner before finishing.

> Next **F5** needs clean slate. Never close or set `Implemented` while validation processes/emulators run or ports remain bound.

---

## Plan Integration

After all validation, **create/update** `## Debug Configuration Checklist` in `.azure/vscode-debug-plan.md`; if absent, append before closing.

```
## Debug Configuration Checklist

Debug Configuration Checklist:
✅ <config-name> — <ready signal + curl result>
✅ <config-name> — <ready signal + curl result>
✅ <compound-name> — each service started once + ready + curl result
```

One line per non-compound/compound config. **Non-compound** ✅ requires observed ready AND curl, or valid skip reason. **Compound** ✅ requires real Step 9: each member started **once**, reached ready, and where applicable passed HTTP—never infer from individuals.
