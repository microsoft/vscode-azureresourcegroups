# Validation

Verify that the generated VS Code debug configuration actually works. This phase runs after all artifacts are generated (Phase 2) and before the closing message.

> ⛔ **MANDATORY.** You MUST execute every step in this file for each launch configuration. Do NOT skip, assume, or approximate results. Do NOT proceed to the closing message until every checklist entry has a real ✅ or ❌ result.

---

## Validation Algorithm

Steps 1–8 apply to each **non-compound** launch configuration in `.vscode/launch.json`; Step 9 then validates each **compound** configuration.

For each **non-compound** launch configuration in `.vscode/launch.json`:

### Step 1: Resolve the Task Chain

- Read the config's `preLaunchTask` value
- Trace the full `dependsOn` chain in `.vscode/tasks.json` to resolve the dependency order

### Step 2: Verify Script Dependencies

- For each task in the resolved chain, verify that its command can actually execute:
   - **Package scripts** (e.g., `npm run clean`, `dotnet build`) — Confirm a matching script entry or build target exists in the project
   - **CLI tool invocations** (e.g., `rimraf`, `concurrently`) — Confirm the tool is installed as a project dependency
   - If a dependency is missing, add it as a project dev dependency before proceeding (see [generate.md § Dependency Availability](generate.md))

### Step 3: Start Services

- Run prerequisite tasks first (install, clean, emulators), then start the `preLaunchTask` itself as a background process

### Step 4: Verify Emulators

- If a `docker-compose.yml` was generated, verify all services started correctly after `docker compose up -d`:
   - **Long-running services** (database emulators, Azurite) → should be running and healthy
   - **One-shot services** (e.g., `db-migrate`) → should have exited with code 0
   - Use `docker compose ps` and `docker compose logs <service>` to check
   - If any service failed, diagnose the issue, fix the configuration, and re-run until all services are healthy or exited cleanly
   - Only mark the config ❌ after exhausting reasonable fix attempts

### Step 5: Confirm Ready Signal

- Watch stdout from the **top-level task** for the ready signal. Look up the expected pattern from `project-types/{type}.md` § Validation Signals § Ready Signal.

### Step 6: Confirm HTTP Reachability

- After the ready signal, confirm with `curl` using the **application HTTP port** (not the debug port). Look up the expected URL and status from `project-types/{type}.md` § Validation Signals § HTTP Verification.

> Use the curl template: `curl -s -o /dev/null -w "%{http_code}" <target>`

> **HTTP verification not applicable:** If the project type's HTTP Verification table says "N/A" or no anonymous/public endpoint is available (e.g., all routes require auth keys), skip HTTP verification. The config can still pass (✅) based on the ready signal alone — note "HTTP verification skipped: {reason}" in the checklist entry.

### Step 7: Per-Debugger-Type Checks

- Run additional checks based on the `type` field in the launch configuration. See the [Per-Runtime Validation Checks](#per-runtime-validation-checks) section below. If no additional checks are listed for the debugger type, skip this step.

### Step 8: Cleanup

- Tear down **every** process this config started — not just the last one. Kill the top-level `preLaunchTask` process **and every task in its resolved `dependsOn` chain** (dev servers, `func host`, watchers, and any emulators started for this config), then confirm the app HTTP port and the debug port are released (e.g. `lsof -i :<port>` returns nothing) before moving to the next config. A lingering process here causes the next config — or the compound — to hit "port already in use".

### Step 9: Validate the Compound Configuration

For each **compound** launch configuration, faithfully run its orchestration — do NOT infer the result from the individual configs.

> ⛔ **Do NOT skip running the compound.** Configs that each pass standalone can still fail when launched together: overlapping or duplicated `dependsOn` chains can start a service more than once, or a second invocation can grab an already-bound port. The user must never see this. You MUST run the compound's orchestration and observe the real result.

- **Confirm the startup graph is deduplicated.** Before running, verify the compound satisfies every rule in [multi-service.md § Deduplicated Startup Graph](multi-service.md) — the compound's effective task graph must start each service exactly once. If any rule is violated, fix the generated config before running; do not validate a graph that can duplicate a service.

- **Run the compound orchestration.** Execute the compound's `preLaunchTask` (the sequenced compound task chain) exactly as VS Code would — run its `dependsOn` members in `dependsOrder: "sequence"`. This is the same terminal-driven orchestration used for the individual configs.

- **Assert each service starts exactly once.** Watch the task output: each service's top-level task must produce exactly one running instance. When an individual config's `preLaunchTask` fires again for an already-running service, that duplicate invocation MUST be a silent no-op (via `instancePolicy: "silent"`) — never a second process. If any service starts a second instance or grabs an already-bound port, that is considered a fail and should be fixed before proceeding.

- **Assert readiness and HTTP reachability per service.** For each member service, confirm its ready signal (as in Step 5) and HTTP reachability (as in Step 6), reusing the same `project-types/{type}.md § Validation Signals` lookups the per-config algorithm uses. Every service must reach its ready signal; every service with an HTTP endpoint must return the expected status via `curl`.

- **Record the result.** Mark the compound ✅ only after **each service started exactly once AND reached its ready signal AND (where applicable) passed HTTP reachability**. Otherwise mark it ❌ with the duplicate/failure evidence.

> **Known limitation:** As with individual configs, the agent validates task orchestration and readiness through the terminal — it does not attach VS Code debuggers to the compound's member configs. Keep the assertion focused on **started exactly once + ready + reachable**.

- **Tear down the compound.** Stop every process the compound started (all member configs and their full task chains) and confirm their ports are released, exactly as in Step 8. This feeds into the final teardown sweep below.

---

## Validation Signal Lookup

Ready signals and HTTP verification targets are defined in each project-type reference file under `§ Validation Signals`. Load the project-type file for the service being validated and read its signal tables.

| Information | Where to find it |
|-------------|-----------------|
| Ready signal (stdout pattern) | `project-types/{type}.md` § Validation Signals § Ready Signal |
| HTTP verification (curl target, expected status) | `project-types/{type}.md` § Validation Signals § HTTP Verification |
| Debugger-specific checks (processName, etc.) | `runtimes/{rt}.md` § Checklist — Live Validation Checks |
| Runtime-specific details (debug port, outFiles) | `runtimes/{rt}.md` § Debugger Properties |

> **Path resolution:** Some project types use subdirectories — see [generate.md § Project Type Path Resolution](generate.md) for the lookup table.

---

## Per-Runtime Validation Checks

Additional runtime-specific checks beyond the generic algorithm. These run after the ready signal and HTTP verification.

> ⛔ You **MUST** load and execute the runtime's live validation checks. Do NOT skip this step or assume the checks pass.

- Load `runtimes/{rt}.md` § Checklist and execute every item under **Live Validation Checks**. Each runtime's checklist contains debugger-specific verifications (e.g., source map verification for Node.js, process attachment verification for .NET).

---

## Final Teardown — Free All Ports Before Handing Back

> ⛔ **MANDATORY — this is a real, recurring user-facing failure.** During validation you start services, dev servers, `func host`, watchers, and emulators as background processes. If ANY of them is still running when you finish, the user's first **F5** hits "port already in use" and the debug session fails on an otherwise-clean project. You MUST leave the workspace with every validation-spawned process stopped and every port these configs use free.

After all individual configs **and** every compound have been validated, and **before** the Plan Integration / status write, sweep and stop everything validation spun up:

1. **Stop every lingering background process** you started during validation — every dev server, `func host`, watcher, and task/language process, across all configs and the compound. Nothing you launched may still be running.
2. **Stop every emulator you started.** If validation ran `docker compose up`, run `docker compose down` (or stop the specific services you started). Do not leave Azurite, database emulators, or any compose service running.
3. **Verify the ports are free again.** Confirm that every port the generated configs will use is released — application HTTP ports, debug ports, and emulator ports. Use `lsof -i :<port>` (and `docker compose ps` for emulators); each must show nothing bound. If any port is still held, find and stop the owning process before finishing.

> A subsequent user **F5** must start from a completely clean slate. Do NOT proceed to the closing message or set status to `Implemented` while any validation-spawned process or emulator is still running, or while any of these ports is still bound.

---

## Plan Integration

After validating all configurations, **create or update** the `## Debug Configuration Checklist` section in `.azure/vscode-debug-plan.md`. If the section does not exist, add it at the end of the plan before closing.

```
## Debug Configuration Checklist

Debug Configuration Checklist:
✅ <config-name> — <ready signal + curl result>
✅ <config-name> — <ready signal + curl result>
✅ <compound-name> — each service started once + ready + curl result
```

One line per config (non-compound and compound). For a **non-compound** config, ✅ requires the ready signal observed AND curl confirmed (or curl skipped with a valid reason). For a **compound** config, ✅ requires the real compound test from Step 9 — each member service started **exactly once** AND reached its ready signal AND (where applicable) passed HTTP reachability — never an inferred pass from the individual results.

> ⛔ Do NOT set status to `Implemented` until every stub in the Debug Configuration Checklist has been replaced with a real ✅ or ❌ result. A checklist with any remaining stubs is incomplete — go back and validate.
