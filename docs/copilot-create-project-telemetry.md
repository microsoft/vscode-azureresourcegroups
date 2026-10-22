# Create Project with Copilot telemetry

This document describes the extension-owned telemetry boundary for the Create New Project with
Copilot (CoR) lifecycle. The schema is versioned with `telemetrySchemaVersion = 2`; existing event
names and established properties remain where practical.

## Correlation and lifecycle

Every CoR command, webview action, MCP tool, reload/folder handoff, debug session, preview result,
and deployment terminal event can be joined through:

| Field | Meaning |
| --- | --- |
| `corProjectId` | Existing random project correlation id. |
| `workflowRunId` | Random id for the authoritative end-to-end Create Project run. It persists in `workspaceState` and crosses the short-lived `.azure/.pending-create` folder handoff. |
| `phaseRunId` | Random id for the current plan/scaffold/integrate/debug/deploy attempt. |
| `parentPhaseRunId` | Previous phase attempt, including the attempt resumed or retried. |
| `attemptNumber` / `retryCount` | Per-phase attempt sequence. Programmatic handoffs between agents in the same phase retain the attempt; only a real resume/retry creates the next attempt. |
| `entryPoint` / `workflowEntryPoint` / `phaseEntryPoint` | Normalized launch boundary such as `createProject`, `mcpTool`, `resume`, or `reloadResume`. |
| `workflowMode` | `guided` or `autopilot`. |
| `lifecycleState` | Terminal outcome of the telemetry action: `succeeded`, `failed`, `canceled`, or `skipped` (`started` while in flight). |
| `phaseLifecycleState` | Persisted outcome of the current workflow phase. |

Actions include `startedTimestamp`, `completedTimestamp`, `actionDurationMs`,
`actionActiveDurationMs`, `actionUserWaitDurationMs`, and `precedingUserWaitDurationMs` for the
extension-owned approval/view wait immediately before the action. The workflow record also accumulates
`workflowDurationMs`, `workflowActiveDurationMs`, and `workflowUserWaitDurationMs`; terminal workflows
also include `workflowCompletedTimestamp` and freeze those durations at completion. Approval/view
wait is counted only at extension-owned UI boundaries; the extension does not guess whether time
inside Copilot Chat was model execution or user think time. Background artifact observations do not
end an approval wait; explicit continuation, cancellation, and folder-handoff boundaries do. The
folder-handoff marker carries the already accumulated user-wait duration so reopening the selected
folder does not reclassify that time as active execution.

Failures use bounded `failureCategory` values (`authentication`, `authorization`, `notFound`,
`conflict`, `rateLimited`, `timeout`, `network`, `validation`, `canceled`, or `unknown`).
Cancellation and skip reasons are normalized tokens. Arbitrary error strings remain in the
workspace-only diagnostics after masking; they are not emitted to telemetry.

## Model and tool boundary

The extension records the values it actually owns:

- requested/display model and resolved requested model id/vendor when the stable VS Code API returns
  them;
- whether selection was explicit or left to the host default;
- count of chat-open model request boundaries;
- count and duration of CoR MCP tool calls, with tool names restricted to the extension's fixed
  allowlist and all unknown values grouped as `other`;
- extension version, repository-owned agent bundle version, and launch prompt contract version.

The bundle and prompt versions are explicit constants that must be incremented with
telemetry-significant changes. Individual agents and skills do not have separate stable version
identifiers, so CoR emits `agentVersionAvailable=false` and `skillVersionAvailable=false` instead
of inventing per-asset versions.

The stable VS Code/Copilot APIs used by this extension do **not** expose the served model or snapshot,
Auto routing decision, fallback/reroute reason, queue time, time to first token, total model
generation duration, prompt/output/reasoning/cache token counts, context size/compression, model
turn count, or the durations of tools owned by Copilot Chat or other extensions. CoR emits explicit
availability flags and keeps the workflow/session/request correlation boundary for a future upstream
join, but it does not infer or fabricate these values. Authoritative capture requires Copilot Chat
or VS Code to expose these fields on the chat-open/tool execution APIs.

Stable VS Code also provides no supported event for a custom chat session being closed, canceled, or
cleared. CoR records terminal outcomes it can authoritatively observe (debug adapter termination,
debug-plan implementation, frontend preview startup, and terminal `deploy-result.json` status).
A deployment that is abandoned before a terminal artifact exists cannot be labeled failed or
canceled without an upstream chat-session lifecycle API.

## Privacy-safe project and deployment shape

Structured artifact telemetry uses allowlisted categories only:

- per-component/service architecture serializes ordered `role`, `type`, `runtime`, and `framework`
  categories without ids, labels, names, paths, commands, prompt text, or free-form descriptions;
- build/deployability, validation, preview, debug checklist, endpoint health, and deployment health
  outcomes are emitted only when an authoritative artifact or extension signal exists;
- deployment inventory aggregates only repository-allowlisted ARM resource types and counts for
  created and failed resources. Unknown or identifier-shaped types are omitted, and nested or
  extension resources are derived from the final ARM provider boundary;
- the current deployment phase is bound to the App Onboard session id before a terminal result can
  complete it. Later inventory enrichment of the same artifact does not create another terminal
  event, and historical results cannot complete a newer attempt;
- `reusedResourceTypeCountsAvailable=false` is emitted because the current deploy-result producer
  has no authoritative reused status. Adding reuse counts requires a producer/schema change rather
  than inferring reuse from created or skipped resources.

Telemetry must never include raw prompts, generated code, file paths, project/resource names, ARM
resource ids, endpoint URLs, subscription/tenant ids, account details, or arbitrary error text.
