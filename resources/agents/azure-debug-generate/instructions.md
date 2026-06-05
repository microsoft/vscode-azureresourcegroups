# Azure VS Code Debug — Generate

> **AUTHORITATIVE GUIDANCE — MANDATORY COMPLIANCE**
>
> This document is the **official, canonical source** for generating VS Code debug
> configuration from an approved plan. You **MUST** follow these instructions
> exactly as written. When in doubt, defer to this document. Do not improvise,
> infer, or substitute steps.

---

## Global Rules (NO EXCEPTIONS)

1. **Plan is the source of truth** — Read `.azure/vscode-debug-plan.md` and generate exactly what it specifies. Only generate artifacts for rows where `Generate` is checked (`[x]`).
2. **Update plan progressively** — Mark steps complete as you go; update **Last Updated** timestamp on every status change
3. ❌ **Destructive actions require `ask_user`** — Always confirm before overwriting, deleting, or modifying existing files
4. **Preserve existing config** — Never silently overwrite project configuration files or `docker-compose.yml`. Merge or ask first.
5. **Scope — VS Code debug setup only** — These instructions are for generating local debug configurations in VS Code. Cloud deployment is handled by **azure-prepare** → **azure-validate** → **azure-deploy**.
6. **Warn on limited support** — When a project type, runtime, or emulator declared in the plan has no matching reference file, emit a `⚠️ LIMITED SUPPORT:` warning — [limited-support.md](references/limited-support.md).

---

## Phase 1: Pre-Flight

Verify the plan and environment before generating any files.

| # | Action | Reference |
|---|--------|-----------|
| 1 | **Verify plan** — Confirm `.azure/vscode-debug-plan.md` exists with status `Approved`. Set status to `Executing` and update **Last Updated**. | `.azure/vscode-debug-plan.md` |
| 2 | **Load references** — For each service in the plan's Services table (where Generate is checked), load the corresponding project-type and runtime reference files. If no reference file exists, emit a limited-support warning. | [limited-support.md](references/limited-support.md) |
| 3 | **Run pre-flight checks** — Stale data directories and port conflicts. | [preflight.md](references/preflight.md) |

---

## Phase 2: Generate

The plan drives implementation. Read each section of `.azure/vscode-debug-plan.md` and generate the corresponding artifacts. Use the reference files for implementation details — the plan specifies WHAT to generate, the references specify HOW.

Follow the generation steps in [generate.md](references/generate.md) in order.

---

## Phase 3: Validate

> ⚠️ **CRITICAL:** You MUST complete every validation step before proceeding. Do NOT mark the task as complete, do NOT set status to `Implemented`, and do NOT deliver a closing message until validation is finished and the checklist is updated with real results.

| # | Action | Reference |
|---|--------|-----------|
| 1 | **Validate each launch configuration** — Follow every step in validation.md for each non-compound config. | [validation.md](references/validation.md) |
| 2 | **Update Debug Configuration Checklist** — Create or update the `## Debug Configuration Checklist` section in `.azure/vscode-debug-plan.md` with real ✅ or ❌ results for each configuration. | [validation.md](references/validation.md) § Plan Integration |
| 3 | **Set status** — Only after every checklist stub has been replaced with a real result, set plan status to `Implemented` and update **Last Updated**. | `.azure/vscode-debug-plan.md` |

> ⛔ **VALIDATION IS NOT OPTIONAL.** Do NOT set status to `Implemented` until every stub in the Debug Configuration Checklist has been replaced with a real ✅ or ❌ result. A checklist with any remaining stubs or missing entries means validation is incomplete — go back and finish it. This is the single most common failure mode.

---

## Outputs

| Artifact | Location |
|----------|----------|
| **Plan** (updated) | `.azure/vscode-debug-plan.md` |
| Docker Compose | `docker-compose.yml` |
| VS Code Debug Config | `.vscode/launch.json` — see [project-types/](references/project-types/) and [runtimes/](references/runtimes/) |
| VS Code Build Config | `.vscode/tasks.json` — see [project-types/](references/project-types/) and [runtimes/](references/runtimes/) |
| VS Code Extensions | `.vscode/extensions.json` — see [generate.md](references/generate.md) § assembly protocol |
| VS Code Settings | `.vscode/settings.json` — see [generate.md](references/generate.md) § assembly protocol |
| Connection Strings | `local.settings.json` or `.env` |
| Convenience Scripts | Runtime-specific script runner (see [runtimes/](references/runtimes/)) |
| API Test Collections | `api-test-collections/{service-id}/<test-name>/invoke.{sh,ps1}` |

---

## Next Steps — MANDATORY CLOSING MESSAGE

After validation, end your response with the following:

| # | Item | What to say |
|---|------|-------------|
| 1 | **Start Debugging** | Tell the user: "Press **F5** in VS Code and select the compound launch configuration (e.g., 'Start All')." |
| 2 | **Offer API Testing** | Offer to run any API test collection scripts on the user's behalf. Caveat - the user must start the app first; the scripts often target `localhost` endpoints that require the app to be running. |
| 3 | **Azure Cloud Deployment** | Mention that for subsequent Azure cloud deployment, hand off to: `azure-prepare` → `azure-validate` → `azure-deploy`. |

Example closing message:

> ## Next Steps
>
> Press **F5** in VS Code and select **Start All** to launch the full application with debugging.
>
> Once the app is running, you can ask me to run the API test collection scripts to verify your endpoints.
>
> When you're ready to deploy to Azure, I can help with that too.
