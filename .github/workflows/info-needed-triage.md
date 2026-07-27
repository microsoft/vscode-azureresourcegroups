---
name: Info Needed Triage
description: Triage newly opened issues that lack enough information to act on, apply the info-needed label, and ask the reporter for exactly what's missing.
on:
  issues:
    types: [opened, reopened]
permissions:
  contents: read
  issues: read
  copilot-requests: write
engine: copilot
model: gpt-5.4
inlined-imports: true
tools:
  github:
    min-integrity: none
imports:
  - microsoft/vscode-azuretools/.github/workflows/shared/info-needed-triage.md@main
timeout-minutes: 10
---

# Info Needed Triage

Triage the issue that triggered this workflow using the shared "Info Needed
Triage Agent" instructions imported above. Apply the `info-needed` label and post
one tailored comment when the issue is an incomplete bug report; otherwise call
`noop`. Never close issues.
