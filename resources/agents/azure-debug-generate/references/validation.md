# Validation

Verify that the generated VS Code debug configuration actually works. This phase runs after all artifacts are generated (Phase 2) and before the closing message.

> ⛔ **MANDATORY.** You MUST execute every step in this file for each launch configuration. Do NOT skip, assume, or approximate results. Do NOT proceed to the closing message until every checklist entry has a real ✅ or ❌ result.

---

## Validation Algorithm

For each **non-compound** launch configuration in `.vscode/launch.json`:

### Step 1: Resolve the Task Chain

1. Read the config's `preLaunchTask` value
2. Trace the full `dependsOn` chain in `.vscode/tasks.json` to resolve the dependency order

### Step 2: Verify Script Dependencies

3. For each task in the resolved chain, verify that its command can actually execute:
   - **Package scripts** (e.g., `npm run clean`, `dotnet build`) — Confirm a matching script entry or build target exists in the project
   - **CLI tool invocations** (e.g., `rimraf`, `concurrently`) — Confirm the tool is installed as a project dependency
   - If a dependency is missing, add it as a project dev dependency before proceeding (see [generate.md § Dependency Availability](generate.md))

### Step 3: Start Services

4. Run prerequisite tasks first (install, clean, emulators), then start the `preLaunchTask` itself as a background process

### Step 4: Verify Emulators

5. If a `docker-compose.yml` was generated, verify all services started correctly after `docker compose up -d`:
   - **Long-running services** (database emulators, Azurite) → should be running and healthy
   - **One-shot services** (e.g., `db-migrate`) → should have exited with code 0
   - Use `docker compose ps` and `docker compose logs <service>` to check
   - If any service failed, diagnose the issue, fix the configuration, and re-run until all services are healthy or exited cleanly
   - Only mark the config ❌ after exhausting reasonable fix attempts

### Step 5: Confirm Ready Signal

6. Watch stdout from the **top-level task** for the ready signal. Look up the expected pattern from `project-types/{type}.md` § Validation Signals § Ready Signal.

### Step 6: Confirm HTTP Reachability

7. After the ready signal, confirm with `curl` using the **application HTTP port** (not the debug port). Look up the expected URL and status from `project-types/{type}.md` § Validation Signals § HTTP Verification.

> Use the curl template: `curl -s -o /dev/null -w "%{http_code}" <target>`

> **HTTP verification not applicable:** If the project type's HTTP Verification table says "N/A" or no anonymous/public endpoint is available (e.g., all routes require auth keys), skip HTTP verification. The config can still pass (✅) based on the ready signal alone — note "HTTP verification skipped: {reason}" in the checklist entry.

### Step 7: Per-Debugger-Type Checks

8. Run additional checks based on the `type` field in the launch configuration. See the Per-Debugger-Type Validation section below. If no additional checks are listed for the debugger type, skip this step.

### Step 8: Cleanup

9. Kill background processes, then move to the next config

### Step 9: Compound Configs

10. For compound configs: skip running them; mark ✅ if all named member configs passed, ❌ if any failed

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

8. Load `runtimes/{rt}.md` § Checklist and execute every item under **Live Validation Checks**. Each runtime's checklist contains debugger-specific verifications (e.g., source map verification for Node.js, process attachment verification for .NET).

---

## Plan Integration

After validating all configurations, **create or update** the `## Debug Configuration Checklist` section in `.azure/vscode-debug-plan.md`. If the section does not exist, add it at the end of the plan before closing.

```
## Debug Configuration Checklist

Debug Configuration Checklist:
✅ <config-name> — <ready signal + curl result>
✅ <config-name> — <ready signal + curl result>
```

One line per config (non-compound and compound). ✅ requires the ready signal observed AND curl confirmed (or curl skipped with a valid reason).

> ⛔ Do NOT set status to `Implemented` until every stub in the Debug Configuration Checklist has been replaced with a real ✅ or ❌ result. A checklist with any remaining stubs is incomplete — go back and validate.
