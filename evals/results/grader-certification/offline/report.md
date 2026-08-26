# Copilot on Rails Grader Certification

- Mode: `offline`
- Fixtures: `sample-agent-output`, `reference-node-fullstack`
- Outcome: **PASSED**
- Cases: 44/44 passed

| Case | Fixture | Validator | Expected | Actual | Result |
|---|---|---|---|---|---|
| `golden-requirements` | `sample-agent-output` | `requirements` | `passed` | `passed` | PASS |
| `golden-project-plan` | `sample-agent-output` | `project-plan` | `passed` | `passed` | PASS |
| `golden-plan-gate` | `sample-agent-output` | `plan-gate` | `passed` | `passed` | PASS |
| `golden-preview` | `sample-agent-output` | `preview` | `passed` | `passed` | PASS |
| `golden-integration-plan` | `sample-agent-output` | `integration-plan` | `passed` | `passed` | PASS |
| `golden-frontend-scaffold` | `sample-agent-output` | `frontend-scaffold` | `passed` | `passed` | PASS |
| `requirements-schema-version` | `sample-agent-output` | `requirements` | `schemaVersion` | `schemaVersion` | PASS |
| `project-plan-numbering` | `sample-agent-output` | `project-plan` | `nonSequentialHeading` | `nonSequentialHeading, nonSequentialHeading` | PASS |
| `plan-gate-frontend-dropped` | `sample-agent-output` | `plan-gate` | `frontendIntentMismatch` | `frontendIntentMismatch` | PASS |
| `plan-gate-preview-manifest-missing` | `sample-agent-output` | `plan-gate` | `previewManifestMissingAtGate` | `previewManifestMissingAtGate` | PASS |
| `preview-not-ready` | `sample-agent-output` | `preview` | `previewNotReady` | `previewNotReady` | PASS |
| `frontend-preview-not-embeddable` | `sample-agent-output` | `frontend-scaffold` | `devServerRejectsWebviewOrigin` | `devServerRejectsWebviewOrigin` | PASS |
| `frontend-dev-script-does-not-serve` | `sample-agent-output` | `frontend-scaffold` | `devScriptDoesNotServe` | `devScriptDoesNotServe` | PASS |
| `frontend-frame-busting-csp` | `sample-agent-output` | `frontend-scaffold` | `previewFrameBusting` | `previewFrameBusting` | PASS |
| `frontend-api-seam-bypassed` | `sample-agent-output` | `frontend-scaffold` | `apiSeamBypassed` | `apiSeamBypassed` | PASS |
| `integration-plan-missing-no-seed-rule` | `sample-agent-output` | `integration-plan` | `missingNoSeedRule` | `missingNoSeedRule` | PASS |
| `integration-plan-missing-backend-run-command` | `sample-agent-output` | `integration-plan` | `missingBackendCommand` | `missingBackendCommand` | PASS |
| `integration-plan-missing-route-inventory` | `sample-agent-output` | `integration-plan` | `missingRouteInventory` | `missingRouteInventory` | PASS |
| `integration-plan-route-inventory-shadowed-by-auth-heading` | `sample-agent-output` | `integration-plan` | `passed` | `passed` | PASS |
| `integration-plan-missing-api-seam` | `sample-agent-output` | `integration-plan` | `missingApiSeam` | `missingApiSeam` | PASS |
| `integration-plan-missing-service-classification` | `sample-agent-output` | `integration-plan` | `missingServiceClassification` | `missingServiceClassification` | PASS |
| `frontend-api-client-interface-dropped` | `sample-agent-output` | `frontend-scaffold` | `missingApiClientInterface` | `missingApiClientInterface` | PASS |
| `frontend-mock-client-dropped` | `sample-agent-output` | `frontend-scaffold` | `missingMockClient` | `missingMockClient` | PASS |
| `integration-plan-no-seed-rule-in-heading` | `sample-agent-output` | `integration-plan` | `passed` | `passed` | PASS |
| `integration-plan-no-seed-rule-as-table-row` | `sample-agent-output` | `integration-plan` | `passed` | `passed` | PASS |
| `integration-plan-port-inside-run-command` | `sample-agent-output` | `integration-plan` | `passed` | `passed` | PASS |
| `integration-plan-missing-backend-port` | `sample-agent-output` | `integration-plan` | `missingBackendPort` | `missingBackendPort` | PASS |
| `golden-debug-plan` | `reference-node-fullstack` | `debug-plan` | `passed` | `passed` | PASS |
| `golden-debug-config` | `reference-node-fullstack` | `debug-config` | `passed` | `passed` | PASS |
| `golden-debug-artifacts` | `reference-node-fullstack` | `debug-artifacts` | `passed` | `passed` | PASS |
| `debug-plan-table-concatenated` | `reference-node-fullstack` | `debug-plan` | `tableRowConcatenated` | `tableRowConcatenated, invalidGenerateMarker` | PASS |
| `debug-plan-checklist-stub` | `reference-node-fullstack` | `debug-plan` | `checklistStub` | `checklistStub` | PASS |
| `debug-plan-diagram-dropped` | `reference-node-fullstack` | `debug-plan` | `missingSection` | `missingSection` | PASS |
| `debug-plan-status-regressed` | `reference-node-fullstack` | `debug-plan` | `unexpectedStatus` | `unexpectedStatus` | PASS |
| `debug-config-prelaunch-dangling` | `reference-node-fullstack` | `debug-config` | `preLaunchTaskUnresolved` | `preLaunchTaskUnresolved` | PASS |
| `debug-config-dependson-dangling` | `reference-node-fullstack` | `debug-config` | `dependsOnUnresolved` | `dependsOnUnresolved` | PASS |
| `debug-config-dependson-cycle` | `reference-node-fullstack` | `debug-config` | `dependsOnCycle` | `dependsOnCycle` | PASS |
| `debug-artifacts-unchecked-config-generated` | `reference-node-fullstack` | `debug-artifacts` | `uncheckedConfigGenerated` | `uncheckedConfigGenerated` | PASS |
| `debug-artifacts-script-not-registered` | `reference-node-fullstack` | `debug-artifacts` | `scriptNotRegistered` | `scriptNotRegistered` | PASS |
| `debug-artifacts-api-collection-empty` | `reference-node-fullstack` | `debug-artifacts` | `apiCollectionEmpty` | `apiCollectionEmpty` | PASS |
| `debug-config-task-run-options` | `reference-node-fullstack` | `debug-config` | `invalidTaskRunOptions` | `invalidTaskRunOptions` | PASS |
| `debug-config-duplicate-task-label` | `reference-node-fullstack` | `debug-config` | `duplicateTaskLabels` | `duplicateTaskLabels, dependsOnUnresolved, dependsOnCycle` | PASS |
| `debug-artifacts-extension-recommendations` | `reference-node-fullstack` | `debug-artifacts` | `invalidExtensionRecommendations` | `invalidExtensionRecommendations` | PASS |
| `debug-artifacts-redacted-secret` | `reference-node-fullstack` | `debug-artifacts` | `redactedSecretPlaceholder` | `redactedSecretPlaceholder` | PASS |

