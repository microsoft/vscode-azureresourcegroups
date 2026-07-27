# Copilot on Rails — Identifier Inventory

An as-is inventory of every identifier participating in the **Copilot on Rails (CoR)** flow:
extension command ids, MCP tool ids/names, `callWithTelemetryAndErrorHandling` telemetry event ids,
diagnostic/webview action names, telemetry property names, workspace-state cache keys, and related
constants. Each entry lists the current value and where it is defined.

The final section proposes a standardization pass to make these consistently identifiable in telemetry.

> Legend for the "Standardized?" column: ✅ already carries a CoR indicator · ⚠️ partial/inconsistent · ❌ no CoR indicator

> **Status — Pass 2 applied.** §1 (command ids) and the seven §3 telemetry event ids are now built through the
> shared helper `corId(name, phase?)` and the `CopilotOnRailsPhase` enum
> constant, producing a `copilotOnRails.<phase>.<name>` (or phase-agnostic `copilotOnRails.<name>`) shape. The phase
> taxonomy was collapsed to three phases: **`scaffold`, `debug`, `deploy`** (planning/scaffolding/integration
> all map to `scaffold`). MCP tool names (§2), the six three-segment `azureResourceGroups.*` events in §3, and
> everything in §4–§8 remain **tabled** — see [§11 Change log & tabled to-dos](#11-change-log--tabled-to-dos).

---

## 1. Extension command ids

Defined in `copilotOnRailsCommandIds` — `src/commands/copilotOnRails/registerCopilotOnRailsCommands.ts:26-55`.
All are contributed in `package.json` and registered via `registerCopilotOnRailsCommand`.

**Pass 2 applied:** every id is built through `corId(name, phase?)` (`CopilotOnRailsPhase` enum in
`src/utils/copilotOnRails/telemetryUtils.ts`), yielding `copilotOnRails.<phase>.<name>` for phase-scoped commands
and phase-agnostic `copilotOnRails.<name>` otherwise. Phases: **`scaffold`, `debug`, `deploy`**. `package.json`
command declarations and menu references were updated in lockstep; internal callers use the `copilotOnRailsCommandIds`
constant (auto-updated). Hardcoded string callers were converted to the constant in `FrontendPreviewViewController.ts`,
`LocalDevNextStepsViewController.ts`, `ScaffoldNextStepsViewController.ts`, and `tree/project/DebugConfigurationNode.ts`.
Agent instruction markdown that invokes these commands was updated (`resources/agents/azure-project-plan.agent.md`,
`azure-project-scaffold.agent.md`, `azure-project-scaffold/instructions.md`).

| Key | Command id (new value) | Was | Phase | Standardized? |
|---|---|---|---|---|
| `createProjectWithCopilot` | `copilotOnRails.scaffold.createProjectWithCopilot` | `azureResourceGroups.createProjectWithCopilot` | scaffold | ✅ (welcome-view `command:` links in `package.nls.json` updated to match) |
| `resumeProjectWithCopilot` | `copilotOnRails.resumeProjectWithCopilot` | `azureResourceGroups.resumeProjectWithCopilot` | — | ✅ |
| `refreshProjectTree` | `copilotOnRails.azureProject.refresh` | `azureProject.refresh` | — | ✅ |
| `downloadAgentInstructions` | `copilotOnRails.scaffold.downloadAgentInstructions` | `azureResourceGroups.downloadAgentInstructions` | scaffold | ✅ |
| `openRequirementsView` | `copilotOnRails.scaffold.openRequirementsView` | `azureResourceGroups.openRequirementsView` | scaffold | ✅ |
| `openScaffoldPlanView` | `copilotOnRails.scaffold.openPlanView` | `azureResourceGroups.openPlanView` | scaffold | ✅ (all three plan views share the `openPlanView` id string; phase disambiguates) |
| `startProjectScaffold` | `copilotOnRails.scaffold.startProjectScaffold` | `azureResourceGroups.startProjectScaffold` | scaffold | ✅ |
| `openFrontendPreviewView` | `copilotOnRails.scaffold.openFrontendPreviewView` | `azureResourceGroups.openFrontendPreviewView` | scaffold | ✅ |
| `startProjectIntegrate` | `copilotOnRails.scaffold.startProjectIntegrate` | `azureResourceGroups.startProjectIntegrate` | scaffold | ✅ |
| `openScaffoldNextStepsView` | `copilotOnRails.scaffold.openNextStepsView` | `azureResourceGroups.openScaffoldNextStepsView` | scaffold | ✅ (id string is the phase-neutral `openNextStepsView`; the `Scaffold` phase disambiguates it) |
| `startLocalDevelopment` | `copilotOnRails.debug.startLocalDevelopment` | `azureResourceGroups.startLocalDevelopment` | debug | ✅ |
| `openLocalPlanView` | `copilotOnRails.debug.openPlanView` | `azureResourceGroups.openLocalPlanView` | debug | ✅ (id string is the phase-neutral `openPlanView`; the `Debug` phase disambiguates it) |
| `startAzureDebugGenerate` | `copilotOnRails.debug.startAzureDebugGenerate` | `azureResourceGroups.startAzureDebugGenerate` | debug | ✅ |
| `openLocalNextStepsView` | `copilotOnRails.debug.openNextStepsView` | `azureResourceGroups.openLocalNextStepsView` | debug | ✅ (id string is the phase-neutral `openNextStepsView`; the `Debug` phase disambiguates it) |
| `debugOpenLocalNextStepsView` | `copilotOnRails.debug.debugOpenLocalNextStepsView` | `azureResourceGroups.debug.openLocalNextStepsView` | debug | ✅ (dev alias; distinct from `debug.openNextStepsView`) |
| `startDebugConfiguration` | `copilotOnRails.debug.startDebugConfiguration` | `azureResourceGroups.startDebugConfiguration` | debug | ✅ |
| `startDeployment` | `copilotOnRails.deploy.startDeployment` | `azureResourceGroups.startDeployment` | deploy | ✅ |
| `openDeploymentPlanView` | `copilotOnRails.deploy.openPlanView` | `azureResourceGroups.openDeployPlanView` | deploy | ✅ (id string is the phase-neutral `openPlanView`; the `Deploy` phase disambiguates it) |
| `inspectDiagnostics` | `copilotOnRails.inspectDiagnostics` | `azureResourceGroups.inspectDiagnostics` | — | ✅ |

Note: `copilotOnRails.startDebugConfiguration` is also referenced from the tree at
`src/tree/project/DebugConfigurationNode.ts:34` (updated).

---

## 2. MCP tool ids (names)

Each tool name is a module-level `const` in `src/chat/tools/copilotOnRails/*.ts`, registered in
`src/chat/tools/copilotOnRails/registerCopilotOnRailsTools.ts`. Names use `snake_case`.

| Constant | Tool name (value) | File | Phase | Standardized? |
|---|---|---|---|---|
| `openRequirementsViewToolName` | `open_requirements_view` | `openRequirementsViewTool.ts:14` | 1 | ❌ |
| `openPlanViewToolName` | `open_plan_view` | `openPlanViewTool.ts:15` | 1 | ❌ |
| `startProjectScaffoldToolName` | `start_project_scaffold` | `startProjectScaffoldTool.ts:14` | 1 | ❌ |
| `openFrontendPreviewViewToolName` | `open_frontend_preview_view` | `openFrontendPreviewViewTool.ts:13` | 1 | ❌ |
| `startProjectIntegrateToolName` | `start_project_integrate` | `startProjectIntegrateTool.ts:14` | 1 | ❌ |
| `openScaffoldNextStepsViewToolName` | `open_scaffold_next_steps_view` | `openScaffoldNextStepsViewTool.ts:13` | 1 | ❌ |
| `startLocalDevelopmentToolName` | `start_local_development` | `startLocalDevelopmentTool.ts:14` | 2 | ❌ |
| `openLocalPlanViewToolName` | `open_local_plan_view` | `openLocalPlanViewTool.ts:15` | 2 | ❌ |
| `startAzureDebugGenerateToolName` | `start_azure_debug_generate` | `startAzureDebugGenerateTool.ts:14` | 2 | ❌ |
| `openLocalNextStepsViewToolName` | `open_local_next_steps_view` | `openLocalNextStepsViewTool.ts:13` | 2 | ❌ |
| `startDeploymentToolName` | `start_deployment` | `startDeploymentTool.ts:14` | 3 | ❌ |
| `openDeployPlanViewToolName` | `open_deploy_plan_view` | `openDeployPlanViewTool.ts:15` | 3 | ❌ |

Each tool wraps execution in `callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: <toolName>, extras }, …)`.

### 2a. MCP tool auto-telemetry event ids

`registerMcpToolWithTelemetry` (from `@microsoft/vscode-inproc-mcp/vscode`) emits telemetry events of the
form `` `mcpTool/${<toolName>}/execute` `` for every tool above (e.g. `mcpTool/open_plan_view/execute`).
These are derived from the tool names in §2, so standardizing the names propagates here automatically.

---

## 3. `callWithTelemetryAndErrorHandling` event ids (webview controllers)

Explicit telemetry event ids raised from CoR webview controllers.

**Pass 2 applied:** the seven `copilotOnRails.submit*` ids are built via the shared `corId(name, phase?)`
helper and the `CopilotOnRailsPhase` enum in `src/utils/copilotOnRails/telemetryUtils.ts`, producing a phase-based
`copilotOnRails.<phase>.<action>` form. The `phase` is optional — omitting it yields a non-phase `copilotOnRails.<action>`
id for events that aren't tied to a phase (e.g. diagnostics). Phases (collapsed to three):
`scaffold`, `debug`, `deploy`. The six three-segment
`azureResourceGroups.*` ids are **tabled** pending a follow-up decision (see §11).

| Telemetry event id (new value) | Was | File | Standardized? |
|---|---|---|---|
| `copilotOnRails.scaffold.submitRequirements` | `copilotOnRails.submitRequirements` | `RequirementsViewController.ts:68` | ✅ |
| `copilotOnRails.scaffold.submitPlanApproval` | `copilotOnRails.submitProjectScaffoldPlanApproval` | `ScaffoldPlanViewController.ts:118` | ✅ |
| `copilotOnRails.scaffold.submitPlanFeedback` | `copilotOnRails.submitProjectScaffoldPlanFeedback` | `ScaffoldPlanViewController.ts:208` | ✅ |
| `copilotOnRails.debug.submitPlanApproval` | `copilotOnRails.submitLocalDebugPlanApproval` | `LocalPlanViewController.ts:64` | ✅ |
| `copilotOnRails.debug.submitPlanFeedback` | `copilotOnRails.submitLocalDebugPlanFeedback` | `LocalPlanViewController.ts:117` | ✅ |
| `copilotOnRails.deploy.submitPlanApproval` | `copilotOnRails.submitDeploymentPlanApproval` | `DeploymentPlanViewController.ts:107` | ✅ |
| `copilotOnRails.deploy.submitPlanFeedback` | `copilotOnRails.submitDeploymentPlanFeedback` | `DeploymentPlanViewController.ts:151` | ✅ |
| `azureResourceGroups.loadingView.needHelpResume` *(tabled)* | — | `LoadingViewController.ts:40` | ⏸️ revisit |
| `azureResourceGroups.scaffoldNextSteps.actionSelected` *(tabled)* | — | `ScaffoldNextStepsViewController.ts:37` | ⏸️ revisit |
| `azureResourceGroups.scaffold.requestBudgetWarning` *(tabled)* | — | `ScaffoldPlanViewController.ts:232` | ⏸️ revisit |
| `azureResourceGroups.scaffoldPlan.refreshPrerequisites` *(tabled)* | — | `ScaffoldPlanViewController.ts:310` | ⏸️ revisit |
| `azureResourceGroups.localDebugPlan.refreshPrerequisites` *(tabled)* | — | `LocalPlanViewController.ts:151` | ⏸️ revisit |
| `azureResourceGroups.localDevNextSteps.actionSelected` *(tabled)* | — | `LocalDevNextStepsViewController.ts:41` | ⏸️ revisit |

---

## 4. Diagnostic / webview action names

Passed as `name` to `callWithDiagnosticsAndTelemetryHandling(context, { type: 'webviewAction', name: … })`.
These become the `DiagnosticEvent.name` and are recorded in the workspace diagnostics cache.

| Action name | File | Standardized? |
|---|---|---|
| `submitRequirements` | `RequirementsViewController.ts:69` | ❌ |
| `submitProjectScaffoldPlanApproval` | `ScaffoldPlanViewController.ts:119` | ❌ |
| `submitProjectScaffoldPlanFeedback` | `ScaffoldPlanViewController.ts:209` | ❌ |
| `scaffoldNextSteps.actionSelected` | `ScaffoldNextStepsViewController.ts:39` | ❌ |
| `submitLocalDebugPlanApproval` | `LocalPlanViewController.ts:65` | ❌ |
| `submitLocalDebugPlanFeedback` | `LocalPlanViewController.ts:118` | ❌ |
| `localDevNextSteps.actionSelected` | `LocalDevNextStepsViewController.ts:43` | ❌ |
| `submitDeploymentPlanApproval` | `DeploymentPlanViewController.ts:108` | ❌ |
| `submitDeploymentPlanFeedback` | `DeploymentPlanViewController.ts:152` | ❌ |

`DiagnosticEvent.type` enum values: `extensionCommand` | `mcpTool` | `webviewAction`
(`src/utils/copilotOnRails/diagnosticUtils.ts:108`).

---

## 5. Telemetry property names

Set on `context.telemetry.properties` throughout the flow.

| Property | Meaning | Primary definition | Standardized? |
|---|---|---|---|
| `isCopilotEvent` | Marks the event as a Copilot-driven event | `telemetryUtils.ts:41` | ⚠️ (`Copilot`, not CoR-specific) |
| `corProjectId` | Persistent project GUID stitching the CoR chain | `telemetryUtils.ts:42` | ✅ (`cor` prefix) |
| `copilotSessionId` | Copilot session id from MCP `extras` | `telemetryUtils.ts:45` | ⚠️ |
| `copilotRequestId` | Copilot request id from MCP `extras` | `telemetryUtils.ts:46` | ⚠️ |
| `autopilot` | Whether the scaffold plan ran in autopilot mode | `ScaffoldPlanViewController.ts:314`; `autopilot.ts` | ❌ |
| `requirementsSelected` | Requirements chosen in the requirements view | `openRequirementsView.ts:84` | ❌ |

Also referenced (same properties) in: `LoadingViewController.ts:42-43`,
`LocalPlanViewController.ts:152-153`, `ScaffoldPlanViewController.ts:312-314`,
`openRequirementsView.ts:82-84`, `inspectDiagnostics.ts:15`.

Note: `isCopilotEvent` is not CoR-exclusive — it is also set in
`src/chat/tools/azureActivityLog/getAzureActivityLog/getAzureActivityLogTool.ts:28`.

---

## 6. Workspace-state cache keys

`ext.context.workspaceState` keys. These already use a `copilotOnRails.` namespace.

| Key | Purpose | File | Standardized? |
|---|---|---|---|
| `copilotOnRails.projectId` | Persistent project GUID (source of `corProjectId`) | `telemetryUtils.ts:13` | ✅ |
| `copilotOnRails.prompt` | Originating project prompt | `diagnosticUtils.ts:11` | ✅ |
| `copilotOnRails.createdAt` | ISO timestamp project first prompted | `diagnosticUtils.ts:27` | ✅ |
| `copilotOnRails.diagnosticEvents` | Cached rolling `DiagnosticEvent[]` (max 50) | `diagnosticUtils.ts:44` | ✅ |

Related constant: `maxCachedEvents = 50` (`diagnosticUtils.ts:43`).

> ⚠️ Cache keys are **persisted in each user's `workspaceState`**. Renaming them is a breaking change
> for in-flight projects unless a migration is added — see recommendations.

---

## 7. Custom agent ids & agent constants

| Identifier | Value | File | Standardized? |
|---|---|---|---|
| `copilotOnRailsCustomAgents.azureProjectPlanCustomAgent` | `azure-project-plan` | `agentInstructions.ts` | ⚠️ (`azure-` prefix) |
| `copilotOnRailsCustomAgents.azureProjectScaffoldCustomAgent` | `azure-project-scaffold` | `agentInstructions.ts` | ⚠️ |
| `copilotOnRailsCustomAgents.azureProjectIntegrateCustomAgent` | `azure-project-integrate` | `agentInstructions.ts` | ⚠️ |
| `copilotOnRailsCustomAgents.azureDebugPlanCustomAgent` | `azure-debug-plan` | `agentInstructions.ts` | ⚠️ |
| `copilotOnRailsCustomAgents.azureDebugGenerateCustomAgent` | `azure-debug-generate` | `agentInstructions.ts` | ⚠️ |
| `copilotOnRailsCustomAgents.azureDeployCustomAgent` | `azure-deploy` | `agentInstructions.ts` | ⚠️ |
| `azureDebugPlanAgent` (duplicate of `azure-debug-plan`) | `azure-debug-plan` | `src/constants.ts:23` | ⚠️ |

Agent instruction folder names (bundled under `resources/agents`): `azure-debug-generate`,
`azure-debug-plan`, `azure-project-plan`, `azure-project-scaffold`, `azure-project-integrate`,
`shared-references` (`agentInstructions.ts`). These are on-disk folder names — **renaming them means
renaming shipped resource folders** and the `.github/agents` copies in user workspaces.

Other agent constants: `WORKSPACE_AGENTS_RELATIVE_PATH = ['.github', 'agents']`,
`VERSION_STAMP_FILE = '.version'` (`agentInstructions.ts`).

> These agent ids are shared with the on-disk instruction folder contract, so they are lower-priority
> (and higher-risk) rename candidates than the telemetry-only identifiers.

---

## 8. Webview view ids

`WebviewRegistry` keys — `src/webviews/copilotOnRails/views/WebviewRegistry.ts:16-26`.

`createProjectView`, `deploymentPlanView`, `frontendPreviewView`, `loadingView`,
`localDevNextStepsView`, `localPlanView`, `requirementsView`, `scaffoldPlanView`,
`scaffoldNextStepsView` — all ❌ (no CoR indicator).

---

## 9. MCP server identity (shared, not CoR-specific)

| Identifier | Value | File |
|---|---|---|
| `mcpServerId` | `vscode-azureresourcegroups.mcp` | `src/constants.ts:27` |
| `mcpServerLabel` | `Copilot Azure Resources Extension Tools` (l10n) | `src/constants.ts:28` |

These belong to the whole extension MCP surface, not just CoR — listed for completeness.

---

## 10. Standardization recommendations

**Goal:** make every CoR identifier trivially filterable in telemetry via a single, consistent token.

### Observed inconsistencies
- **Three different prefixing schemes** for telemetry-facing ids: `azureResourceGroups.*` (commands,
  some events), `copilotOnRails.*` (some events + all cache keys), and bare `snake_case` (MCP tools).
- **Mixed event-id prefixes in the same controllers** (§3): e.g. `ScaffoldPlanViewController` emits both
  `copilotOnRails.submitProjectScaffoldPlanApproval` and `azureResourceGroups.scaffold.requestBudgetWarning`.
- **Key/value mismatches** in command ids are now **intentional and by design**: several object keys map to a
  shared, phase-neutral id string that the phase segment disambiguates — the three plan views
  (`openScaffoldPlanView`/`openLocalPlanView`/`openDeploymentPlanView`) all emit `openPlanView`
  (`scaffold`/`debug`/`deploy.openPlanView`), and the two next-steps views emit `openNextStepsView`.
- **`snake_case` MCP names** carry no CoR marker, so `mcpTool/*/execute` events can't be filtered as CoR.

### Proposed indicator
Adopt a single token — **`copilotOnRails` / `cor`** — as the CoR marker (it already exists as the
cache-key namespace and the `corProjectId` property, so it's the lowest-friction choice):

| Category | Current pattern | Proposed pattern |
|---|---|---|
| Extension command ids (§1) | `azureResourceGroups.<name>` | `azureResourceGroups.copilotOnRails.<name>` |
| MCP tool names (§2) | `<snake_case>` | `cor_<snake_case>` (e.g. `cor_open_plan_view`) |
| Webview telemetry events (§3) | `azureResourceGroups.*` **or** `copilotOnRails.*` | unify on `copilotOnRails.<view>.<action>` |
| Webview action names (§4) | bare camelCase | prefix `copilotOnRails.` to match §3 |
| Telemetry properties (§5) | mixed | already carry `isCopilotEvent`/`corProjectId`; no rename needed — these tag events instead |

### Priority / risk ordering
1. **Low risk, high value — do first:** MCP tool names (§2, also fixes §2a auto-events) and webview
   telemetry event ids (§3). These are telemetry-only strings; renaming has no user-facing/persistence impact.
2. **Low risk:** webview action names (§4) — internal diagnostic strings only.
3. **Medium risk:** extension command ids (§1) — must update `package.json` contributions, menus/when-clauses,
   and any tree/keybinding references (e.g. `DebugConfigurationNode.ts:34`) in lockstep. User keybindings
   referencing old ids would break.
4. **Higher risk — needs migration:** workspace-state cache keys (§6). Changing them orphans in-flight
   project state unless a read-old/write-new migration is added.
5. **Highest risk — cross-contract:** custom agent ids & instruction folder names (§7). These are also a
   filesystem/resource contract (`resources/agents`, `.github/agents`), so treat separately from telemetry work.

### Alternative (zero-rename) option
Because `isCopilotEvent` and `corProjectId` are already stamped on every CoR event by
`callWithDiagnosticsAndTelemetryHandling`, CoR events are **already filterable via property** without
renaming ids. If the sole goal is telemetry filtering, tightening/renaming is optional; the id-rename work
above is primarily about human readability/consistency of the event names themselves.

---

## 11. Change log & tabled to-dos

### Pass 2 — applied (this change)
- **Phase taxonomy collapsed** from five (`projectPlan`/`projectScaffold`/`projectIntegrate`/`debug`/`deploy`) to
  three: **`scaffold`, `debug`, `deploy`**. Planning, scaffolding, and integration all map to `scaffold` (the
  scaffold phase token was subsequently shortened from `projectScaffold` to `scaffold`; the enum member is
  `CopilotOnRailsPhase.Scaffold`).
- **Shared builder** — a single exported `corId(name, phase?)` in `telemetryUtils.ts` builds both command ids and
  telemetry event ids as `copilotOnRails.<phase>.<name>` (or phase-agnostic `copilotOnRails.<name>`). (Earlier
  drafts had separate `corCommandId`/`corTelemetryEventId` wrappers; these were collapsed into `corId` since they
  produced identical output.)
- **§1 Extension command ids** — `copilotOnRailsCommandIds` rebuilt via `corId`, adding phase segments:
  `scaffold.*` (openRequirementsView, openPlanView, startProjectScaffold, openFrontendPreviewView,
  startProjectIntegrate, openScaffoldNextStepsView), `debug.*` (startLocalDevelopment, openPlanView,
  startAzureDebugGenerate, openLocalNextStepsView, startDebugConfiguration), `deploy.*` (startDeployment,
  openPlanView). Phase-agnostic: createProjectWithCopilot, resumeProjectWithCopilot, azureProject.refresh,
  downloadAgentInstructions, inspectDiagnostics. All three plan views share the phase-neutral id string
  `openPlanView` and both next-steps views share `openNextStepsView`, differentiated only by phase
  (e.g. `scaffold.openPlanView` / `debug.openPlanView` / `deploy.openPlanView`). The dev alias
  `debugOpenLocalNextStepsView` was kept
  phase-agnostic (`copilotOnRails.debugOpenLocalNextStepsView`), distinct from
  `debug.openNextStepsView`. Updated the palette/menu-contributed ids in `package.json`; converted the 4
  hardcoded `executeCommand` string callers to use the `copilotOnRailsCommandIds` constant; updated agent markdown
  (`openPlanView` → `scaffold.openPlanView`, `startProjectIntegrate` → `scaffold.startProjectIntegrate`).
- **§3 Telemetry event ids** — `submitRequirements` moved from `projectPlan` to `scaffold`
  (`copilotOnRails.scaffold.submitRequirements`); all others unchanged under the collapsed taxonomy.
- Verified: `tsc --noEmit` clean, `package.json` valid JSON, ESLint clean on changed files.

### Pass 1 — applied (earlier)
- **§1 Extension command ids** — all 19 re-prefixed to `copilotOnRails.` (`azureProject.refresh` →
  `copilotOnRails.azureProject.refresh`). Updated `package.json` command declarations + menu/commandPalette
  references, hardcoded `executeCommand`/tree-item strings, and agent-instruction markdown that invokes them.
  Internal callers using the `copilotOnRailsCommandIds` constant update automatically.
- **§3 Telemetry event ids (2-segment `copilotOnRails.submit*` only)** — reshaped to phase-based
  `copilotOnRails.<phase>.<action>` via the `corId` helper + `CopilotOnRailsPhase` enum.

### Tabled — revisit next
1. **§2 MCP tool names** (`snake_case`, e.g. `open_plan_view`) and their auto-emitted
   `mcpTool/<name>/execute` telemetry events — deferred by request; decide on a CoR marker (e.g. `cor_` prefix).
2. **§3 three-segment `azureResourceGroups.*` events** (6 of them: `loadingView.needHelpResume`,
   `scaffoldNextSteps.actionSelected`, `scaffold.requestBudgetWarning`, `scaffoldPlan.refreshPrerequisites`,
   `localDebugPlan.refreshPrerequisites`, `localDevNextSteps.actionSelected`) — these already have a
   `<area>.<action>` shape; decide whether to re-prefix to `copilotOnRails.<phase>.<action>` and how their
   existing area segment maps to the phase taxonomy.
3. **NLS title keys** in `package.json` (`%azureResourceGroups.openPlanView%`, etc.) still use the old
   namespace. They are display-title lookup keys (resolved from `package.nls.json`), independent of the
   command id, so they were intentionally left untouched. Rename for consistency if desired (also rename the
   matching keys in `package.nls.json`).
4. **§4 Webview/diagnostic action names** (`submitRequirements`, `submitProjectScaffoldPlanApproval`, …) —
   internal `DiagnosticEvent.name` strings; align with the §3 phase taxonomy if desired.
5. **§5 Telemetry properties** (`autopilot`, `requirementsSelected`) — no CoR marker; low priority (events
   are already tagged via `isCopilotEvent`/`corProjectId`).
6. **§6 Workspace-state cache keys** — already namespaced `copilotOnRails.*`; only rename with a migration.
7. **§7 Custom agent ids / instruction folder names** — cross-contract with `resources/agents` +
   `.github/agents`; treat separately from telemetry work.
8. **§8 Webview view ids** — no CoR marker.

### Related findings (not renamed)
- `azureResourceGroups.debug.openLoadingView` is **declared in `package.json` but has no handler** registered
  in `src/` and is not part of `copilotOnRailsCommandIds`. Likely an orphan/leftover — confirm and either wire
  it up or remove it (and rename to `copilotOnRails.*` at that time).
- `azureResourceGroups.createProjectWithCopilot.pendingDeadline`
  (`src/webviews/copilotOnRails/extension/createProjectWithCopilot.ts:20`) is a **globalState key**, not a
  command id. Left as-is (falls under §6-style cache-key handling).
