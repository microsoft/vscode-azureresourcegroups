---
description: 'Keep the Create New Project with Copilot pipeline, commands, MCP tools, state, agents, and evals aligned.'
applyTo: "src/webviews/copilotOnRails/**,src/commands/copilotOnRails/**,src/chat/tools/copilotOnRails/**,src/utils/copilotOnRails/**,src/tree/project/**,resources/agents/**,test/copilotOnRails/**,evals/**"
---

# Copilot on Rails workflow instructions

Also follow the matching Copilot on Rails artifact-security and documentation instructions. They define
the untrusted artifact boundary and required user-guide/runbook updates.

## Pipeline ownership

- `src/commands/copilotOnRails/registerCopilotOnRailsCommands.ts`: command IDs, command telemetry wrapper,
  phase entry points, and command-to-view/agent wiring.
- `src/chat/tools/copilotOnRails/registerCopilotOnRailsTools.ts`: in-process MCP tool catalog. Tools
  should be thin adapters over the same commands, views, and services used by extension UI.
- `src/webviews/copilotOnRails/extension/**`: launch/resume/autopilot orchestration, controllers, artifact
  loading, watchers, and singleton view lifecycle.
- `src/webviews/copilotOnRails/views/**`: React rendering and destination-specific parsing of artifact
  data.
- `src/tree/project/**`: artifact inventory, stage/progress tree, debug configuration discovery, and
  project submission state.
- `src/utils/copilotOnRails/**`: diagnostics, telemetry, deployment inventory, migration firewall leases,
  model selection, and project reset.
- `resources/agents/**`: shipped agent contracts and handoff references.
- `test/copilotOnRails/**`, `evals/**`: deterministic unit coverage plus headless/real-VS-Code behavior
  contracts.

## State and artifact rules

- Keep artifact path constants in `src/tree/project/projectPlanFiles.ts`; do not hard-code a second copy
  in commands, tools, views, or tests.
- Use the existing filesystem walk for ignored `.copilot-azure/sessions/**` artifacts; VS Code search can
  hide them through `.gitignore` and search exclusions.
- `projectSession.ts` is the extension-owned source of truth for the last launched phase and selected
  model. Agent-written `.azure/*` files are work products, not authority for phase progress.
- Update phase state only when the extension has authoritative knowledge, preserve resume context, and
  distinguish programmatic view handoffs from user-abandoned flows.
- A new or changed artifact must be wired through parsing/validation, watchers, progress state, resume,
  diagnostics/privacy handling, documentation, tests, and applicable eval fixtures.
- Preserve explicit approval gates. Autopilot may automate documented transitions but must not bypass
  required plan, deployment, destructive-action, or security approval.

## Commands, tools, webviews, and agents

- Run commands and MCP tools through the shared Copilot diagnostics/telemetry context. Keep telemetry
  bounded and never record prompts, plan contents, paths, resource names/IDs, or secrets.
- Keep each MCP tool schema narrow, validate all input, return structured failure information, and do not
  report success before the underlying command or durable action succeeds.
- Keep extension controllers and React views separated. Parse untrusted data before rendering and keep
  webview lifecycle/disposal in the shared controller/host helpers.
- Agent names, commands, MCP tool names, handoff prompts, artifact names, and progress-tree actions form
  one contract. Change every reference and the user documentation together.
- Changes under `resources/agents/**` must preserve the corresponding Vally/MSBench scenarios and pass
  the repository's agent-drift check. Mirror source-of-truth scenario changes where the MSBench README
  requires it.

Add focused tests for the changed stage and run `npm run lint` for agent-contract changes. Use the
narrowest applicable eval command when behavior—not just static wiring—changes.
