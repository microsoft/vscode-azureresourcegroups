# Copilot on Rails Grader Certification

- Mode: `offline`
- Fixture: `reference-node-fullstack`
- Outcome: **PASSED**
- Cases: 26/26 passed

| Case | Validator | Expected | Actual | Result |
|---|---|---|---|---|
| `golden-requirements` | `requirements` | `passed` | `passed` | PASS |
| `golden-project-plan` | `project-plan` | `passed` | `passed` | PASS |
| `golden-plan-gate` | `plan-gate` | `passed` | `passed` | PASS |
| `golden-preview` | `preview` | `passed` | `passed` | PASS |
| `golden-debug-plan` | `debug-plan` | `passed` | `passed` | PASS |
| `golden-debug-config` | `debug-config` | `passed` | `passed` | PASS |
| `golden-debug-artifacts` | `debug-artifacts` | `passed` | `passed` | PASS |
| `requirements-schema-version` | `requirements` | `schemaVersion` | `schemaVersion` | PASS |
| `project-plan-numbering` | `project-plan` | `nonSequentialHeading` | `nonSequentialHeading, nonSequentialHeading` | PASS |
| `plan-gate-frontend-dropped` | `plan-gate` | `frontendIntentMismatch` | `frontendIntentMismatch` | PASS |
| `plan-gate-preview-manifest-missing` | `plan-gate` | `previewManifestMissingAtGate` | `previewManifestMissingAtGate` | PASS |
| `preview-not-ready` | `preview` | `previewNotReady` | `previewNotReady` | PASS |
| `debug-plan-table-concatenated` | `debug-plan` | `tableRowConcatenated` | `tableRowConcatenated, invalidGenerateMarker` | PASS |
| `debug-plan-checklist-stub` | `debug-plan` | `checklistStub` | `checklistStub` | PASS |
| `debug-plan-diagram-dropped` | `debug-plan` | `missingSection` | `missingSection` | PASS |
| `debug-plan-status-regressed` | `debug-plan` | `unexpectedStatus` | `unexpectedStatus` | PASS |
| `debug-config-prelaunch-dangling` | `debug-config` | `preLaunchTaskUnresolved` | `preLaunchTaskUnresolved` | PASS |
| `debug-config-dependson-dangling` | `debug-config` | `dependsOnUnresolved` | `dependsOnUnresolved` | PASS |
| `debug-config-dependson-cycle` | `debug-config` | `dependsOnCycle` | `dependsOnCycle` | PASS |
| `debug-artifacts-unchecked-config-generated` | `debug-artifacts` | `uncheckedConfigGenerated` | `uncheckedConfigGenerated` | PASS |
| `debug-artifacts-script-not-registered` | `debug-artifacts` | `scriptNotRegistered` | `scriptNotRegistered` | PASS |
| `debug-artifacts-api-collection-empty` | `debug-artifacts` | `apiCollectionEmpty` | `apiCollectionEmpty` | PASS |
| `debug-config-task-run-options` | `debug-config` | `invalidTaskRunOptions` | `invalidTaskRunOptions` | PASS |
| `debug-config-duplicate-task-label` | `debug-config` | `duplicateTaskLabels` | `duplicateTaskLabels, dependsOnUnresolved, dependsOnCycle` | PASS |
| `debug-artifacts-extension-recommendations` | `debug-artifacts` | `invalidExtensionRecommendations` | `invalidExtensionRecommendations` | PASS |
| `debug-artifacts-redacted-secret` | `debug-artifacts` | `redactedSecretPlaceholder` | `redactedSecretPlaceholder` | PASS |

