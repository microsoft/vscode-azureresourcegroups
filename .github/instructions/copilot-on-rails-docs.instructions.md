---
description: 'Keep the Create New Project with Copilot (Copilot on Rails) user guide and support runbook in sync whenever the feature changes.'
applyTo: "src/webviews/copilotOnRails/**, src/commands/copilotOnRails/**, src/chat/tools/copilotOnRails/**, src/utils/copilotOnRails/**, src/tree/project/**, resources/agents/**"
---

# Keep the Copilot on Rails docs in sync

You are editing the **Create New Project with Copilot** feature (codename *Copilot on Rails*, command prefix
`copilotOnRails.`). Its end-user guide and support/triage runbook lives at
[docs/copilot-create-project.md](../../docs/copilot-create-project.md).

**Rule:** any change to this feature's user-visible behavior, surfaces, or support flow must be reflected in
that document **in the same change**. Treat the doc as part of the feature — a change that alters behavior
without updating it is incomplete.

## When a change requires a doc update

Update the matching section of `docs/copilot-create-project.md` when you:

| Change | Section(s) to update |
| --- | --- |
| Add / rename / remove a `copilotOnRails.*` command (TS handler **or** `package.json` / `package.nls.json`) | UI surfaces reference (Part 3), Commands appendix, and the relevant stage |
| Add / rename / remove an MCP tool (`src/chat/tools/copilotOnRails/**`) | The MCP tools table and the pipeline diagram |
| Add / change / remove a webview or its behavior (`src/webviews/copilotOnRails/**`) | UI surfaces table, the stage that uses it, and its screenshot |
| Add / change / remove an agent or a hand-off (`resources/agents/**`) | The agents table, the Mermaid pipeline diagram, and the affected stage |
| Change a `.azure/*` artifact, the `.github/agents` download behavior, or a `workspaceState` key | Files & state |
| Change what diagnostics capture, or the Report Issue / Inspect Diagnostics behavior | Support & triage runbook, including the "What the diagnostics contain (privacy)" section |
| Change the launch / resume / empty-folder / autopilot flow | Launching, Resuming a session, and Autopilot mode |

## New or changed UI — flag screenshots to re-capture

Screenshots are captured by hand and stored separately, so the agent can't re-shoot them. When your change
touches the UI, **tell the developer which images to refresh** and why:

- **Altered an existing screen** (relabeled or moved control, restyled view, new or removed field, changed
  copy, different states): its screenshot is now **stale even though the placeholder already exists**. Name
  the affected file(s) and say in one line what changed.
- **Added a brand-new screen or state**: add the matching `📷` placeholder (the blockquote plus its centered
  `<p align="center"><img …></p>` reference — images in this doc are centered, not raw `![]()`) and a
  screenshot references section, then tell the dev it needs a first capture.
- **Removed a screen**: delete its placeholder and checklist entry, and note the removal.
- Never delete an existing placeholder just because its PNG is still missing — the images are captured
  separately from the prose.
- When unsure whether a visual change is significant, flag it anyway.

Use this map from source area to the screenshot(s) it backs:

| You changed… | Screenshot(s) to re-capture |
| --- | --- |
| `src/tree/project/**`, the `azureProject` view / welcome content | `01-launch-azure-project-view.png`, `12-azure-project-progress-tree.png` |
| The launch / empty-folder / resume flow (`createProjectWithCopilot.ts`, `resume*`) | `02-empty-folder-prompt.png`, `11-resume-prompt.png` |
| `CreateProjectView` (prompt + model picker) | `03-create-project-prompt.png` |
| `RequirementsView` | `04-requirements-view.png` |
| `ScaffoldPlanView` / plan preview (incl. UI preview cards) | `05-plan-preview.png` |
| `FrontendPreviewView` (Approve UI) | `06-frontend-preview-approve-ui.png` |
| `ScaffoldNextStepsView` | `07-scaffold-next-steps.png` |
| `LocalPlanView` (debug plan) | `08-debug-plan-view.png` |
| `LocalDevNextStepsView` | `09-debug-next-steps.png` |
| `DeploymentPlanView` | `10-deployment-plan-view.png` |
| `reportIssue` (issue template) | `13-report-issue-github.png` |
| `inspectDiagnostics` (JSON payload) | `14-inspect-diagnostics-json.png` |

## Before you finish

- **Report screenshots to the developer:** in your summary, list every image your change makes stale (by
  filename, with a one-line reason) plus any placeholders you added or removed, so they can capture or
  refresh them. If your change touched no UI, say so.
- Re-read the affected sections and confirm every command id, MCP tool name, agent name, file path, and
  view→command mapping still matches the code you changed.
- Keep the reference tables and the Mermaid pipeline diagram accurate.
- If nothing user-visible changed (a pure internal refactor), no doc update is needed — note that briefly
  instead of editing the doc.
