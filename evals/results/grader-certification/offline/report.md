# Copilot on Rails Grader Certification

- Mode: `offline`
- Fixture: `sample-agent-output`
- Outcome: **PASSED**
- Cases: 27/27 passed

| Case | Validator | Expected | Actual | Result |
|---|---|---|---|---|
| `golden-requirements` | `requirements` | `passed` | `passed` | PASS |
| `golden-project-plan` | `project-plan` | `passed` | `passed` | PASS |
| `golden-plan-gate` | `plan-gate` | `passed` | `passed` | PASS |
| `golden-preview` | `preview` | `passed` | `passed` | PASS |
| `golden-integration-plan` | `integration-plan` | `passed` | `passed` | PASS |
| `golden-frontend-scaffold` | `frontend-scaffold` | `passed` | `passed` | PASS |
| `requirements-schema-version` | `requirements` | `schemaVersion` | `schemaVersion` | PASS |
| `project-plan-numbering` | `project-plan` | `nonSequentialHeading` | `nonSequentialHeading, nonSequentialHeading` | PASS |
| `plan-gate-frontend-dropped` | `plan-gate` | `frontendIntentMismatch` | `frontendIntentMismatch` | PASS |
| `plan-gate-preview-manifest-missing` | `plan-gate` | `previewManifestMissingAtGate` | `previewManifestMissingAtGate` | PASS |
| `preview-not-ready` | `preview` | `previewNotReady` | `previewNotReady` | PASS |
| `frontend-preview-not-embeddable` | `frontend-scaffold` | `devServerRejectsWebviewOrigin` | `devServerRejectsWebviewOrigin` | PASS |
| `frontend-dev-script-does-not-serve` | `frontend-scaffold` | `devScriptDoesNotServe` | `devScriptDoesNotServe` | PASS |
| `frontend-frame-busting-csp` | `frontend-scaffold` | `previewFrameBusting` | `previewFrameBusting` | PASS |
| `frontend-api-seam-bypassed` | `frontend-scaffold` | `apiSeamBypassed` | `apiSeamBypassed` | PASS |
| `integration-plan-missing-no-seed-rule` | `integration-plan` | `missingNoSeedRule` | `missingNoSeedRule` | PASS |
| `integration-plan-missing-backend-run-command` | `integration-plan` | `missingBackendCommand` | `missingBackendCommand` | PASS |
| `integration-plan-missing-route-inventory` | `integration-plan` | `missingRouteInventory` | `missingRouteInventory` | PASS |
| `integration-plan-route-inventory-shadowed-by-auth-heading` | `integration-plan` | `passed` | `passed` | PASS |
| `integration-plan-missing-api-seam` | `integration-plan` | `missingApiSeam` | `missingApiSeam` | PASS |
| `integration-plan-missing-service-classification` | `integration-plan` | `missingServiceClassification` | `missingServiceClassification` | PASS |
| `frontend-api-client-interface-dropped` | `frontend-scaffold` | `missingApiClientInterface` | `missingApiClientInterface` | PASS |
| `frontend-mock-client-dropped` | `frontend-scaffold` | `missingMockClient` | `missingMockClient` | PASS |
| `integration-plan-no-seed-rule-in-heading` | `integration-plan` | `passed` | `passed` | PASS |
| `integration-plan-no-seed-rule-as-table-row` | `integration-plan` | `passed` | `passed` | PASS |
| `integration-plan-port-inside-run-command` | `integration-plan` | `passed` | `passed` | PASS |
| `integration-plan-missing-backend-port` | `integration-plan` | `missingBackendPort` | `missingBackendPort` | PASS |

