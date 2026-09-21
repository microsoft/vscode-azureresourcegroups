# azd Template Routing

Prereq-detected existing azd template routes AppOnboard to `azure-prepare`, not greenfield pipeline. AppOnboard handles greenfield deployments; repos with existing Azure IaC belong to prepare → validate → deploy.

## Detection

Before scope triage (Step 2), check workspace root + `infra/` only; never scan `.copilot-azure/`. Route only when ALL true:

| Condition | Where to check |
|-----------|----------------|
| `azure.yaml` exists in workspace root | File system scan |
| `*.bicep` or `*.tf` files exist in `infra/` | File system scan |
| `azure.yaml` has `services:` with 1+ entries | Read `azure.yaml` in workspace root |

If only `azure.yaml` exists without IaC files (partial azd setup), continue AppOnboard; repo needs generated IaC.

## Gate — presented as the scope triage question

When azd template detected, replace scope triage with azd-aware version (see [intent-gathering.md § Scope triage](intent-gathering.md)). Present:

```
📦 **Existing Azure deployment setup detected**

Your repo already has:
- `azure.yaml` — Azure Developer CLI configuration
- `infra/` — {Bicep|Terraform} infrastructure templates
{list any other detected infra: Dockerfiles, CI/CD workflows}

This is a complete azd template — it already defines how to build and deploy your app.

**How would you like to proceed?**

1. **Deploy with existing setup** — I'll hand off to `azure-prepare`, which works with azd templates natively. It will analyze your IaC, plan the deployment, and walk you through `azd up`.

2. **Start fresh** — Ignore the existing IaC and build new infrastructure from scratch using AppOnboard's greenfield pipeline. Your existing files won't be modified.

3. **Just scan for readiness** — Keep the prereq results (your app is {ready|needs fixes}) and stop here.
```

## Routing protocol

**Option 1 — Deploy with existing setup:**

1. Write routing state to `context.json`:
   ```json
   {
     "routeToSkill": "azure-prepare",
     "routeReason": "existing-azd-template",
     "completedPhases": [],
     "currentPhase": null,
     "statusSummary": "Routed to azure-prepare — existing azd template detected, prereq scan skipped (not needed for existing IaC)"
   }
   ```
2. Tell user:
   ```
   ✅ Your app is healthy — prereq scan found no blockers.

   Since your repo has a complete azd setup, I'm handing off to **azure-prepare** — it's purpose-built
   for repos with existing IaC and works natively with `azd up`.
   ```
3. **Invoke azure-prepare directly:** Hand off to `azure-prepare`, then follow its workflow using original prompt from `context.json.intent.userPrompt`. Same as Step 3 prereq invocation: AppOnboard hands off; agent follows instructions. Never ask user to type a command.
4. **STOP AppOnboard pipeline.** Never continue to Step 5 (plan architecture), generate IaC, or run `azd up`. azure-prepare owns remaining conversation.

**Option 2 — Start fresh:**

1. Write override to `context.json.overrides[]`: `{ "key": "ignoreExistingInfra", "value": "true", "reason": "User chose greenfield over existing azd template" }`
2. If `infra/` exists, rename once to `infra.bak/`, preserving existing IaC before scaffold writes.
3. Continue AppOnboard pipeline from Step 5 (plan architecture).
4. Skip Scaffold Step 3 because override exists; backup already done.

**Option 3 — Just scan:**

1. Update `context.json.statusSummary` to reflect the scan-only outcome.
2. Present prereq results summary; STOP.

## Edge cases

| Scenario | Handling |
|----------|----------|
| `azure.yaml` exists but `infra/` is empty | NOT azd template; continue AppOnboard (repo needs IaC) |
| `azure.yaml` exists with `infra.provider: terraform` | Route same as Bicep — azure-prepare handles both |
| User chose "Start fresh" then hits scaffold guard | Scaffold guard bypassed via `ignoreExistingInfra` override |
| Prereq found blockers AND repo has azure.yaml | Present blockers first (prereq triage), then azd gate. Blockers win. |
| `azure.yaml`/`infra/` might be AppOnboard leftover | Ours only if **any** `.copilot-azure/sessions/*/scaffold-manifest.json` `files[]` lists it; check every session, not only active, to catch abandoned-run leftovers. Otherwise treat as user's → route → STOP. ⛔ Never decide via git status; never delete/overwrite—move to `.copilot-azure/sessions/<id>/replaced-files/` (mirror path). |
