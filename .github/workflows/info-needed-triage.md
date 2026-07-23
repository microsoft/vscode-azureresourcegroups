---
name: Info Needed Triage
description: Triage newly opened issues that lack enough information to act on, apply the info-needed label, and ask the reporter for exactly what's missing.
on:
  issues:
    types: [opened, reopened]
permissions:
  contents: read
  issues: read
engine: copilot
inlined-imports: true
imports:
  - microsoft/vscode-azuretools/.github/workflows/shared/info-needed-triage.md@9c44f023bca9b84554c07f3a622491e1ac7e635d
timeout-minutes: 10
---

# Info Needed Triage

Triage the issue that triggered this workflow using the shared "Info Needed
Triage Agent" instructions imported above. Apply the `info-needed` label and post
one tailored comment when the issue is an incomplete bug report; otherwise call
`noop`. Never close issues.
