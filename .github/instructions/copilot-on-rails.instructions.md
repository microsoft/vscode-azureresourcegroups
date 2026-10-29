---
description: 'Keep Copilot on Rails commands, MCP tools, artifact handoffs, webviews, and resumable project state consistent.'
applyTo: "src/webviews/copilotOnRails/**, src/commands/copilotOnRails/**, src/chat/tools/copilotOnRails/**, src/utils/copilotOnRails/**, src/tree/project/**, resources/agents/**, test/copilotOnRails/**"
---

# Copilot on Rails pipeline

Read [the artifact-security contract](copilot-on-rails-artifact-security.instructions.md) and
[documentation-sync requirements](copilot-on-rails-docs.instructions.md) as well as this guide.
Those files remain the authority for untrusted artifacts and user-guide/screenshot updates; do not
weaken them or duplicate their inventories here.

## Entry points and state

- Follow `registerCopilotOnRailsCommands.ts`, `registerCopilotOnRailsTools.ts`, and their shared
  handlers before changing an entry point. Keep manifest commands, MCP registration, agent tool
  references, phase transitions, and the project progress tree aligned.
- Preserve `CopilotOnRailsContext` setup and `callWithDiagnosticsAndTelemetryHandling` for command
  and MCP paths. Use `setCorProp` only for data safe in both diagnostics and telemetry, and
  `setCorErrorProp` for masked errors; neither wrapper makes arbitrary project content safe.
- Agents coordinate through files such as `.azure/project-plan.md` and the debug/deployment
  artifacts, not an assumed shared chat history. Keep artifact names, approval gates, and
  producing/consuming phases consistent across TypeScript, shipped prompts, and evals.
- Reuse `openChatWithAgent.ts` for chat readiness, workspace trust, instruction installation,
  model selection, fresh-chat launches, and reload guards. Do not bypass these from a new MCP tool
  or view controller, or record a launch as successful when the shared helper deferred or failed.
- Treat reload/resume and folder selection as normal flow, not error recovery afterthoughts.
  Follow `createProjectWithCopilot.ts`, `resumePendingCreateWithCopilot.ts`, `projectSession.ts`,
  and `src/tree/project` watchers. Preserve the `.azure/.pending-create` handoff and distinguish
  workspace state from session artifacts.
- New watchers must handle partial writes and repeated events without duplicate launches or
  panels. Preserve approval and submission state; a file appearing must not imply user approval.
  Follow the migration-firewall lease/reconciliation helpers for temporary database access rather
  than relying on an agent to remember cleanup after interruption.

## Extension/browser boundary

- Keep VS Code APIs, filesystem/process access, and privileged actions in `extension` controllers
  and helpers; React UI stays in `views`. Put genuinely shared data/parsing code in `shared`
  without pulling extension-only dependencies into the browser bundle.
- Reuse `SingletonViewHost` for matching single-panel/file-watcher lifecycles. Preserve the
  distinction between a user closing a panel and extension shutdown, so disposal does not erase
  resumable state.
- Preserve the typed controller/view message contract. Validate untrusted values before they
  become commands, paths, URLs, process arguments, or rendered content, including initial data
  embedded into webview HTML. Reuse the existing parsers and escaping helpers.

## Checks

- Add focused coverage in `test/copilotOnRails` for the changed parser, state transition, launch,
  watcher, or approval boundary. Include malformed/partial artifacts and reload/re-entry cases
  when those are affected.
- `npm run build` bundles the webview through `esbuild.mjs`, but the root TypeScript check excludes
  `views`. For React changes, also type-check its project with
  `npx --no-install tsc --noEmit -p src/webviews/copilotOnRails/views/tsconfig.json`.
- Agent prompt/reference changes also require the
  [agent/evaluation checks](agent-evals.instructions.md); extension tests alone do not verify
  the shipped prompt contracts.
