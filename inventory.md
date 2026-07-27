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
`scaffold`, `debug`, `deploy`. The six three-segment `azureResourceGroups.*` ids have now also been
standardized to `copilotOnRails.<phase>.<action>` (or phase-agnostic) via `corId`.

| Telemetry event id (new value) | Was | File | Standardized? |
|---|---|---|---|
| `copilotOnRails.scaffold.submitRequirements` | `copilotOnRails.submitRequirements` | `RequirementsViewController.ts:68` | ✅ |
| `copilotOnRails.scaffold.submitPlanApproval` | `copilotOnRails.submitProjectScaffoldPlanApproval` | `ScaffoldPlanViewController.ts:118` | ✅ |
| `copilotOnRails.scaffold.submitPlanFeedback` | `copilotOnRails.submitProjectScaffoldPlanFeedback` | `ScaffoldPlanViewController.ts:208` | ✅ |
| `copilotOnRails.debug.submitPlanApproval` | `copilotOnRails.submitLocalDebugPlanApproval` | `LocalPlanViewController.ts:64` | ✅ |
| `copilotOnRails.debug.submitPlanFeedback` | `copilotOnRails.submitLocalDebugPlanFeedback` | `LocalPlanViewController.ts:117` | ✅ |
| `copilotOnRails.deploy.submitPlanApproval` | `copilotOnRails.submitDeploymentPlanApproval` | `DeploymentPlanViewController.ts:107` | ✅ |
| `copilotOnRails.deploy.submitPlanFeedback` | `copilotOnRails.submitDeploymentPlanFeedback` | `DeploymentPlanViewController.ts:151` | ✅ |
| `copilotOnRails.loadingView.needHelpResume` | `azureResourceGroups.loadingView.needHelpResume` | `LoadingViewController.ts:40` | ✅ (phase-agnostic) |
| `copilotOnRails.scaffold.nextStepsAction` | `azureResourceGroups.scaffoldNextSteps.actionSelected` | `ScaffoldNextStepsViewController.ts:37` | ✅ |
| `copilotOnRails.scaffold.requestBudgetWarning` | `azureResourceGroups.scaffold.requestBudgetWarning` | `ScaffoldPlanViewController.ts:232` | ✅ |
| `copilotOnRails.scaffold.refreshPrerequisites` | `azureResourceGroups.scaffoldPlan.refreshPrerequisites` | `ScaffoldPlanViewController.ts:310` | ✅ |
| `copilotOnRails.debug.refreshPrerequisites` | `azureResourceGroups.localDebugPlan.refreshPrerequisites` | `LocalPlanViewController.ts:151` | ✅ |
| `copilotOnRails.debug.nextStepsAction` | `azureResourceGroups.localDevNextSteps.actionSelected` | `LocalDevNextStepsViewController.ts:41` | ✅ |

---

## 4. Diagnostic / webview action names

Passed as `name` to `callWithDiagnosticsAndTelemetryHandling(context, { type: 'webviewAction', name: … })`.
These become the `DiagnosticEvent.name` and are recorded in the workspace diagnostics cache.

| Action name | File | Standardized? |
|---|---|---|
| `submitRequirements` | `RequirementsViewController.ts:69` | ✅ (unchanged) |
| `submitScaffoldPlanApproval` | `ScaffoldPlanViewController.ts:119` | ✅ |
| `submitScaffoldPlanFeedback` | `ScaffoldPlanViewController.ts:209` | ✅ |
| `scaffoldNextStepsAction` | `ScaffoldNextStepsViewController.ts:40` | ✅ |
| `submitDebugPlanApproval` | `LocalPlanViewController.ts:65` | ✅ |
| `submitDebugPlanFeedback` | `LocalPlanViewController.ts:118` | ✅ |
| `debugNextStepsAction` | `LocalDevNextStepsViewController.ts:44` | ✅ |
| `submitDeploymentPlanApproval` | `DeploymentPlanViewController.ts:108` | ✅ (unchanged) |
| `submitDeploymentPlanFeedback` | `DeploymentPlanViewController.ts:152` | ✅ (unchanged) |

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
| `copilotOnRails.projectId` | Persistent project GUID (source of `corProjectId`) | `telemetryUtils.ts` | ✅ |
| `copilotOnRails.prompt` | Originating project prompt | `diagnosticUtils.ts:11` | ✅ |
| `copilotOnRails.createdAt` | ISO timestamp project first prompted | `diagnosticUtils.ts:27` | ✅ |
| `copilotOnRails.diagnosticEvents` | Cached rolling `DiagnosticEvent[]` (max 50) | `diagnosticUtils.ts:44` | ✅ |
| `copilotOnRails.autopilot.active` | Autopilot run active flag (workspaceState) | `autopilot.ts:39` | ✅ (renamed from `azureResourceGroups.*`) |
| `copilotOnRails.autopilot.priorAutoApprove` | Prior global auto-approve value (workspaceState) | `autopilot.ts:40` | ✅ (renamed) |
| `copilotOnRails.autopilot.priorPermissionLevel` | Prior permission level (workspaceState) | `autopilot.ts:41` | ✅ (renamed) |
| `copilotOnRails.autopilot.deadline` | Autopilot auto-approve deadline (workspaceState) | `autopilot.ts:43` | ✅ (renamed) |
| `copilotOnRails.createProjectWithCopilot.pendingDeadline` | Pending-create deadline (globalState) | `createProjectWithCopilot.ts:20` | ✅ (renamed) |

Related constant: `maxCachedEvents = 50` (`diagnosticUtils.ts:43`).

> ⚠️ Cache keys are **persisted in each user's `workspaceState`/`globalState`**. The five `azureResourceGroups.*`
> keys were renamed to `copilotOnRails.*` **without a migration** (per decision), so any in-flight state under
> the old keys is orphaned. Future renames of the remaining keys likewise require a migration to preserve state.

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

### Pass 3 — applied (this change)
- **§2 MCP tool names** — decided to **leave as-is** (clean `snake_case`, model-facing contract referenced in
  ~50 agent-md spots and already CoR-scoped by their agents). No CoR marker added.
- **§3 three-segment events** — all six re-prefixed to `copilotOnRails.<phase>.<action>` via `corId`:
  `loadingView.needHelpResume` (phase-agnostic), `scaffold.nextStepsAction`, `scaffold.requestBudgetWarning`,
  `scaffold.refreshPrerequisites`, `debug.refreshPrerequisites`, `debug.nextStepsAction`. The old `<area>`
  segment was dropped except that the two next-steps events fold it into a single `nextStepsAction` action word.
- **NLS title keys** — the 7 CoR command display-title keys were re-labelled from `azureResourceGroups.*`
  to match their command ids (`copilotOnRails.<phase>.<name>`) in both `package.json` (`"title": "%...%"`
  refs) and `package.nls.json` (the key definitions). Visible button text unchanged. Mapping:
  `openPlanView`→`scaffold.openPlanView`, `openLocalPlanView`→`debug.openPlanView`,
  `openDeployPlanView`→`deploy.openPlanView`, `openRequirementsView`→`scaffold.openRequirementsView`,
  `openFrontendPreviewView`→`scaffold.openFrontendPreviewView`,
  `openLocalNextStepsView`→`debug.openNextStepsView`, `openScaffoldNextStepsView`→`scaffold.openNextStepsView`.
- **§4 diagnostic action names** — the 9 write-only `DiagnosticEvent.name` strings were standardized to
  phase-qualified camelCase (kept as short bare names, no `copilotOnRails.` prefix, distinct from the outer
  telemetry event id): `submitRequirements`, `submitScaffoldPlanApproval`, `submitScaffoldPlanFeedback`,
  `scaffoldNextStepsAction`, `submitDebugPlanApproval`, `submitDebugPlanFeedback`, `debugNextStepsAction`,
  `submitDeploymentPlanApproval`, `submitDeploymentPlanFeedback`. (The webview *message* command
  `submitRequirements` in RequirementsView.tsx/RequirementsViewController is a separate protocol and untouched.)
- Verified: `tsc --noEmit` clean, ESLint clean on the 5 changed controllers.
- **§6 state keys** — the five CoR-related keys still under `azureResourceGroups.*` were renamed to the
  `copilotOnRails.*` namespace (no migration, in-flight state orphaned, per decision): `autopilot.active`,
  `autopilot.priorAutoApprove`, `autopilot.priorPermissionLevel`, `autopilot.deadline` (workspaceState in
  `autopilot.ts`), and `createProjectWithCopilot.pendingDeadline` (globalState in `createProjectWithCopilot.ts`).
  The 4 pre-existing `copilotOnRails.*` cache keys were already standardized.
- **§5 telemetry properties** — decided to **leave** `autopilot` and `requirementsSelected` as-is (events are
  already CoR-tagged via `isCopilotEvent` + `corProjectId`).
- **§7 custom agent ids / folder names** — decided to **leave as-is** (shipped `resources/agents` folder +
  `.github/agents` workspace-copy contract, referenced across agent `.md` files; like the MCP tool names).
- **§8 webview view ids** — decided to **leave as-is** (internal panel/routing ids paired between
  `WebviewRegistry` keys and each controller's `viewType` constructor arg; no telemetry/persistence exposure).

### Tabled — revisit next
_All inventory sections have been reviewed; nothing remains tabled._

### Related findings (not renamed)
- `copilotOnRails.debug.openLoadingView` is **declared in `package.json` but has no handler** registered
  in `src/` and is not part of `copilotOnRailsCommandIds`. Likely an orphan/leftover — confirm and either wire
  it up or remove it (and rename to `copilotOnRails.*` at that time).
- `copilotOnRails.createProjectWithCopilot.pendingDeadline`
  (`src/webviews/copilotOnRails/extension/createProjectWithCopilot.ts:20`) is a **globalState key**, not a
  command id. Renamed from `azureResourceGroups.*` to `copilotOnRails.*` as part of §6 (no migration).
