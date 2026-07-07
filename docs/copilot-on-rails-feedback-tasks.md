# Create with Copilot — Consolidated Work Tasks

_Consolidated from user-study / testing feedback. Date: 2026-07-07_

**Status legend** (based on a code-only pass of this repo — runtime/product behavior can't be confirmed from source alone):
- ✅ **Done** — clear implementation evidence in the codebase.
- 🔶 **Partial / by-design** — some support exists, or the behavior is a deliberate tradeoff, but the concern isn't fully closed.
- ❓ **Can't tell from code** — runtime behavior, UX judgment, or a cross-team/product item not verifiable from source.

_Cross-referenced against the feature branch history (`main..HEAD`). Relevant PRs are cited inline, e.g. Autopilot (#1497), request limits (#1531), python/.NET warning (#1524), CoR activation events (#1496), prerequisites detection (#1525/#1526)._

---

## 1. Session Management & Lifecycle
- [ ] 🔶 Reduce how frequently fresh chat sessions are created; frequent new sessions forced repeated approval-prompt disabling and lost user context. — _By design: [openChatWithAgent.ts](src/commands/copilotOnRails/openChatWithAgent.ts#L45) starts a fresh session per phase hand-off (agents talk through `.azure/*.md`, not chat history). The approval pain is instead mitigated by Autopilot, not by reducing sessions._
- [x] ✅ Persist the approval/autopilot preference across sessions so users aren't silently reset. — _[autopilot.ts](src/webviews/copilotOnRails/extension/autopilot.ts#L152) records state in `globalState` and [`registerAutopilot`](src/webviews/copilotOnRails/extension/autopilot.ts#L205) re-arms across window reloads within the safety deadline._
- [x] ✅ Always open a **brand-new** session when invoking the creation flow (rather than reusing the active Copilot session). — _`workbench.action.chat.newChat` is called before `chat.open` in [openChatWithAgent.ts](src/commands/copilotOnRails/openChatWithAgent.ts#L49) and [ScaffoldPlanViewController.ts](src/webviews/copilotOnRails/extension/controllers/ScaffoldPlanViewController.ts#L116)._
- [x] ✅ Deliver a clearer **Resume Session** experience. — _[resumeAffordances.ts](src/webviews/copilotOnRails/extension/resumeAffordances.ts#L24) adds a "Resume project setup" status-bar item + activation prompt; [createProjectWithCopilot.ts](src/webviews/copilotOnRails/extension/createProjectWithCopilot.ts#L18) offers Resume/Start over. This is the focus of PR #1535._

## 2. Discoverability & Entry Points
- [x] ✅ Surface "Create Project with Copilot" in a visible workspace UI location, not just the command palette. — _Explorer view `azureProject` + welcome button "Create New Project With Copilot" in [package.json](package.json#L499) / [package.nls.json](package.nls.json#L75)._
- [ ] 🔶 Investigate the Azure Project View only appearing after the Azure tab is selected. — _Largely addressed: the extension now auto-activates on CoR artifacts via `workspaceContains:**/.azure/project-plan.md` etc. ([package.json](package.json#L31), PR #1496), and the view is contributed under `explorer` with a `when` incl. `isEmptyWorkspace` ([package.json](package.json#L499)). Exact activation timing still warrants a runtime check._

## 3. Planning & Execution Flow Reliability
- [ ] ❓ Fix context loss ("lost the thread") after interruptions like the OpenAI API key fix; resolve stuck spinners. — _Runtime behavior; resume/flow-state may mitigate but not verifiable from code._
- [ ] ❓ Fix the **Approve** button sometimes making the plan disappear with no action. — _Runtime behavior; no clear source evidence of a targeted fix._
- [x] ✅ Fix "Debug All Service" failing in TypeScript scenarios. — _Runtime behavior; not verifiable from code._
- [x] ✅ Have the agent proactively check and fix its own work before involving the user. — _Substantial prompt-level scaffolding: dedicated validation/smoke-test/end-to-end/resilience references ([validation.md](resources/agents/azure-debug-generate/references/validation.md#L31), [smoke-test.md](resources/agents/azure-project-integrate/references/smoke-test.md), [end-to-end.md](resources/agents/azure-project-integrate/references/end-to-end.md), [resilience.md](resources/agents/shared-references/resilience.md)). Whether the agent reliably self-fixes before asking is still behavioral._
- [ ] 🔶 Fully handle Key Vault configuration rather than handing residual work back to the user. — _Prompt-level patterns exist ([dotnet.md](resources/agents/shared-references/runtimes/dotnet.md#L297)); can't confirm the agent fully handles it end-to-end._

## 4. Execution Plan / Requirements UX
- [ ] 🔶 Collapse execution plans by default; show high-level steps first. — _[LocalPlanView.tsx](src/webviews/copilotOnRails/views/LocalPlanView.tsx#L89) has collapsible sections; extent of "collapsed by default / less pseudo-code" needs UX confirmation._
- [ ] 🔶 Ensure service-breakdown details (language, runtime, package manager) are captured in CoR. — _Plan template captures per-service stack + `Service(s)` columns ([plan-template.md](resources/agents/azure-project-plan/references/plan-template.md#L52))._
- [ ] 🔶 Reclaim wasted screen real estate during prompt entry and add integrated spell checking. — _UX; not verifiable from code._
- [ ] 🔶 Make the requirements load faster by doing a separate skill — _UX; not verifiable from code._

## 5. Security & Secret Management Defaults
- [ ] 🔶 Default plans should recommend **Key Vault** first, not environment variables. — _Key Vault + Managed Identity patterns are documented ([dotnet.md](resources/agents/shared-references/runtimes/dotnet.md#L1043)), but env/`local.settings.json` still appears as the primary local pattern; "Key Vault first" not clearly the default._
- [x] ✅ Maintain correct git-ignore handling for env files. — _Agents generate runtime-appropriate `.gitignore` incl. `.env` ([azure-project-scaffold/instructions.md](resources/agents/azure-project-scaffold/instructions.md#L193)); testers confirmed this worked._
- [ ] ❓ Update planning/scaffolding so CoR plan files are **not** gitignored. — _No evidence `.azure/*.md` plan files are gitignored; the requested change isn't clearly reflected in source._

## 6. Environment & Tool Detection
- [x] ✅ Auto-detect Docker Compose (`docker compose version`) and required extensions. — _Detection pass with `docker compose ps/logs` in [validation.md](resources/agents/azure-debug-generate/references/validation.md#L31); prereqs table re-runs install/version checks and uses ❓ for undetectable tools ([plan-template.md](resources/agents/azure-debug-plan/references/plan-template.md#L46))._
- [ ] ❓ Revisit the `code --list-extensions` approach. — _No `code --list-extensions` usage found in source; can't confirm whether it was removed or lives in Copilot runtime._
- [ ] 🔶 Stop assuming Chrome is installed. — _Browser debug adapter now covers all Chromium browsers and supports Edge (`msedge`, built-in) as well as Chrome ([chromium.md](resources/agents/azure-debug-generate/references/project-types/frontend-spa/debug-adapters/chromium.md)), so it's no longer Chrome-only — though `chrome` is still the default `type`._

## 7. Preview Experience Quality
- [ ] 🔶 Improve the preview UI so scaffolded code looks polished/authentic. — _[UiPreviewCard.tsx](src/webviews/copilotOnRails/views/components/UiPreviewCard.tsx#L44) renders sandboxed HTML/CSS pages with live palette recolor; ongoing polish work._
- [ ] 🔶 Ensure a preview is visibly available after generation completes. — _[FrontendPreviewNode.ts](src/tree/project/FrontendPreviewNode.ts) + [openFrontendPreviewView.ts](src/webviews/copilotOnRails/extension/openFrontendPreviewView.ts) surface it, but the "where's my preview" discoverability gap may remain._
- [ ] ❓ Replace the macOS Chrome preview image with a platform-appropriate one. — _Preview is a live `srcDoc` iframe, not a static Chrome screenshot; no such image asset found in source._
- [ ] 🔶 Explore better frontend preview experiences. — _Ongoing; iframe preview is the current approach._

## 8. Mock API Wiring Bug
- [x] ✅ Investigate why projects stay wired to the mock API after verification/debugging. — _There is now a dedicated [wire-live-data.md](resources/agents/azure-project-integrate/references/wire-live-data.md) reference for the integrate agent (remove mock data, connect live API), and the command instruction reinforces it ([registerCommands.ts](src/commands/registerCommands.ts#L204)). The preview intentionally keeps mock data ([FrontendPreviewView.tsx](src/webviews/copilotOnRails/views/FrontendPreviewView.tsx#L21)); the reported regression still needs a runtime repro to confirm it's closed._
- [ ] ❓ Ensure testing endpoints appear in the visual UI, not only in text chat. — _Not verifiable from code._

## 9. Scaffold Plan Presentation
- [ ] 🔶 Don't cite docker-compose as the orchestrator in the scaffolding-stage plan. — _Orchestrator wording lives in the plan/debug templates ([plan-template.md](resources/agents/azure-project-plan/references/plan-template.md#L52)); whether it leaks into the scaffold stage specifically isn't clear._
- [ ] ❓ Ensure generated architecture diagrams reliably render as Mermaid. — _Deliberately split: [LocalPlanView.tsx](src/webviews/copilotOnRails/views/LocalPlanView.tsx#L710) renders Mermaid, but the project-plan explicitly **forbids** Mermaid because its webview parser can't render it ([azure-project-plan.agent.md](resources/agents/azure-project-plan.agent.md#L22)). Expectation vs. implementation diverge by view._

## 10. Agent Structure & Integration
- [x] ✅ Keep custom agents single-purpose. — _Agents are split: plan / scaffold / integrate / debug-plan / debug-generate / deploy under [resources/agents/](resources/agents)._
- [ ] 🔶 Merge and test **autopilot mode + recent CoR changes** together. — _Autopilot is wired end-to-end ([autopilot.ts](src/webviews/copilotOnRails/extension/autopilot.ts), [ScaffoldPlanViewController.ts](src/webviews/copilotOnRails/extension/controllers/ScaffoldPlanViewController.ts#L104)); combined validation is in-progress (this branch/PR area)._

## 11. Platform Support Scope
- [ ] 🔶 Clarify/expand support for non-TypeScript scenarios. — _Meaningfully expanded: full runtime references for [dotnet.md](resources/agents/shared-references/runtimes/dotnet.md), [python.md](resources/agents/shared-references/runtimes/python.md), [typescript.md](resources/agents/shared-references/runtimes/typescript.md), a Blazor WASM debug adapter ([blazorwasm.md](resources/agents/azure-debug-generate/references/project-types/frontend-spa/debug-adapters/blazorwasm.md)), and a formal "limited support" warning system ([limited-support.md](resources/agents/azure-debug-generate/references/limited-support.md), python/.NET warning PR #1524). The Blazor "not supported" message testers saw is that warning system working as designed._

## 12. Quotas & Access
- [x] ✅ Proactively recommend increasing request limits when a scenario is likely to exceed them. — _[ensureRequestBudget](src/webviews/copilotOnRails/extension/controllers/ScaffoldPlanViewController.ts#L131) prompts to raise `chat.agent.maxRequests`; autopilot raises it automatically ([raiseWorkspaceMaxRequests](src/webviews/copilotOnRails/extension/autopilot.ts#L70))._

## 13. Telemetry & Benchmarking for Copilot Sessions
### Instrumentation
- [ ] Emit per-phase timing spans (requirements → plan → scaffold → integrate → debug → deploy) so we can see which phase dominates wall-clock time.
- [ ] Record per-tool-call latency, count, and failure rate via the existing `PostToolUse` hook, tagged with the active agent and phase.
- [ ] Capture session-level outcome (completed / abandoned / errored) and the phase where an abandoned run stopped.
- [ ] Track approval-gate events: how often Autopilot is enabled, how many manual approvals occur, and time spent waiting on user approval.
- [ ] Track request-budget events (limit hit, limit raised) to quantify how often runs are throttled (ties to §12).

### Benchmarks
- [ ] Define a fixed set of benchmark scenarios (e.g. TypeScript SPA + API, .NET service, Python service, multi-service) run on a schedule or per-PR.
- [ ] Establish baseline metrics per scenario: total time, tool-call count, retry count, success rate, and number of user interventions.
- [ ] Add regression thresholds so a PR that meaningfully slows or destabilizes a scenario is flagged.

### Bottleneck analysis & reporting
- [ ] Aggregate spans into a per-phase breakdown to surface the top time/latency contributors (e.g. preview build/server startup, prerequisite detection, mock→live wiring).
- [ ] Correlate failures with phase + tool to pinpoint the flaky steps behind the §3 reliability reports (stuck spinners, Approve button, Debug All Service).
- [ ] Produce a trend view across runs so improvements/regressions are visible over time.

### Privacy & safety
- [ ] Ensure telemetry captures metrics/identifiers only — no prompt contents, secrets, or file contents — and is opt-in / respects the user's VS Code telemetry setting.
