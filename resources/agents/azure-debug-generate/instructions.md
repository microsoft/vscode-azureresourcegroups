# Azure Debug Generate

> **AUTHORITATIVE GUIDANCE — MANDATORY COMPLIANCE**
>
> Official canonical source for generating VS Code debug configuration from an
> approved plan. Follow exactly. When unsure, defer here; never improvise, infer,
> or substitute steps.

---

## Global Rules (NO EXCEPTIONS)

1. **Plan is the source of truth** — Read `.azure/vscode-debug-plan.md`; generate exactly its specifications, only for rows with `Generate` checked (`[x]`).
2. **Update plan progressively** — Mark completed steps; update **Last Updated** on every status change
3. ❌ **Destructive actions require `ask_user`** — Always confirm before overwriting, deleting, or modifying existing files
4. **Preserve existing config** — Never silently overwrite project configuration files or `docker-compose.yml`; merge or ask first.
5. **Scope — VS Code debug setup only** — Generate local VS Code debug configurations only. **azure-deploy** handles cloud architecture, IaC generation, provisioning, and deployment through the complete **azure-app-onboard** pipeline.
6. **Warn on limited support** — If a planned project type, runtime, or emulator lacks a matching reference file, emit `⚠️ LIMITED SUPPORT:` — [limited-support.md](references/limited-support.md).

---

## Autopilot mode

**Active when** chat query starts with `[AUTOPILOT MODE]`, or `.azure/vscode-debug-plan.md` contains `executionMode: auto` or equivalent. Run unattended:
- **Do NOT call `ask_user`.** Freshly generated project makes scaffolded config overwrite/merge expected and safe. Proceed without prompting, but preserve and merge existing configs; never overwrite blindly.
- Run all Phase 3 validation and write `Implemented`. Status `Implemented` signals completion and makes the extension restore its auto-approve setting.

---

## Phase 1: Pre-Flight

Verify plan and environment before file generation.

| # | Action | Reference |
|---|--------|-----------|
| 1 | **Verify plan** — Require `.azure/vscode-debug-plan.md` with status `Approved`. Set `Executing`; update **Last Updated**. | `.azure/vscode-debug-plan.md` |
| 2 | **Load references** — For each checked Services-table service, load matching project-type and runtime references. If absent, emit limited-support warning. | [limited-support.md](references/limited-support.md) |
| 3 | **Run pre-flight checks** — Stale data directories and port conflicts. | [preflight.md](references/preflight.md) |

---

## Phase 2: Generate

Plan drives implementation. Read every `.azure/vscode-debug-plan.md` section and generate corresponding artifacts. Plan defines WHAT; references define HOW.

Follow the generation steps in [generate.md](references/generate.md) in order.

---

## Phase 3: Validate

> ⚠️ **CRITICAL:** Complete every validation step before proceeding. Never finish, set
> `Implemented`, or close until validation finishes and checklist contains real results.

| # | Action | Reference |
|---|--------|-----------|
| 1 | **Validate each launch configuration** — Run every validation.md step for each non-compound config. | [validation.md](references/validation.md) |
| 2 | **Validate the compound configuration** — Run each compound's orchestration per validation.md § Step 9; never infer from individual configs. | [validation.md](references/validation.md) § Step 9 |
| 3 | **Tear down validation processes** — Stop **every** spawned process and emulator (`docker compose down`); verify all app HTTP, debug, and emulator ports free, leaving clean F5 startup. | [validation.md](references/validation.md) § Final Teardown |
| 4 | **Update Debug Configuration Checklist** — Create/update `## Debug Configuration Checklist` in `.azure/vscode-debug-plan.md` with real ✅/❌ per configuration. | [validation.md](references/validation.md) § Plan Integration |
| 5 | **Set status** — After replacing every checklist stub with a real result, set `Implemented`; update **Last Updated**. | `.azure/vscode-debug-plan.md` |

> ⛔ **VALIDATION IS NOT OPTIONAL.** Set `Implemented` only after every Debug
> Configuration Checklist stub becomes real ✅/❌. Remaining stubs or missing
> entries mean incomplete validation; finish them. This is the most common failure.

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

## Post-Generation

After validation reaches `Implemented`, **stop**. No next steps or closing message; `azure-debug-generate` handles post-generation guidance and interactive next steps.

## Troubleshooting

For Edge or Chrome startup issues, see [chromium.md](references/project-types/frontend-spa/debug-adapters/chromium.md).
