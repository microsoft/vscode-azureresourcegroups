# Copilot on Rails Grader Certification

- Mode: `offline`
- Fixtures: `stage-scaffold`, `sample-agent-output`, `reference-node-fullstack`, `reference-node-multiservice`, `reference-python-api`, `reference-dotnet-api`, `reference-go-unsupported`, `debug-probe-verdict`, `unapproved-plan-refusal`, `api-only-no-datastore`, `reference-iac-bicep`
- Outcome: **PASSED**
- Cases: 127/127 passed

| Case | Fixture | Validator | Expected | Actual | Result |
|---|---|---|---|---|---|
| `golden-frontend-scaffold` | `stage-scaffold` | `frontend-scaffold` | `passed` | `passed` | PASS |
| `golden-integration-plan` | `stage-scaffold` | `integration-plan` | `passed` | `passed` | PASS |
| `golden-requirements` | `sample-agent-output` | `requirements` | `passed` | `passed` | PASS |
| `golden-project-plan` | `sample-agent-output` | `project-plan` | `passed` | `passed` | PASS |
| `golden-plan-gate` | `sample-agent-output` | `plan-gate` | `passed` | `passed` | PASS |
| `golden-preview` | `sample-agent-output` | `preview` | `passed` | `passed` | PASS |
| `golden-integration-plan` | `sample-agent-output` | `integration-plan` | `passed` | `passed` | PASS |
| `golden-frontend-scaffold` | `sample-agent-output` | `frontend-scaffold` | `passed` | `passed` | PASS |
| `golden-project-builds` | `sample-agent-output` | `project-builds` | `passed` | `passed` | PASS |
| `frontend-scaffold-dot-directory-ignored` | `sample-agent-output` | `frontend-scaffold` | `frontendNotFound` | `frontendNotFound` | PASS |
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
| `project-builds-frontend-at-repo-root` | `sample-agent-output` | `project-builds` | `passed` | `passed` | PASS |
| `project-builds-frontend-missing` | `sample-agent-output` | `project-builds` | `frontendNotScaffolded` | `frontendNotScaffolded` | PASS |
| `project-builds-no-packages` | `sample-agent-output` | `project-builds` | `noPackagesFound` | `noPackagesFound, frontendNotScaffolded` | PASS |
| `project-builds-unparseable-manifest` | `sample-agent-output` | `project-builds` | `unparseablePackageManifest` | `unparseablePackageManifest, frontendNotScaffolded` | PASS |
| `frontend-at-repo-root` | `sample-agent-output` | `frontend-scaffold` | `passed` | `passed` | PASS |
| `frontend-product-named-folder` | `sample-agent-output` | `frontend-scaffold` | `passed` | `passed` | PASS |
| `integration-plan-no-seed-rule-in-heading` | `sample-agent-output` | `integration-plan` | `passed` | `passed` | PASS |
| `integration-plan-no-seed-rule-as-table-row` | `sample-agent-output` | `integration-plan` | `passed` | `passed` | PASS |
| `integration-plan-port-inside-run-command` | `sample-agent-output` | `integration-plan` | `passed` | `passed` | PASS |
| `integration-plan-missing-backend-port` | `sample-agent-output` | `integration-plan` | `missingBackendPort` | `missingBackendPort` | PASS |
| `integration-plan-database-section-dropped` | `sample-agent-output` | `integration-plan` | `missingDatabase` | `missingDatabase` | PASS |
| `golden-debug-plan` | `reference-node-fullstack` | `debug-plan` | `passed` | `passed` | PASS |
| `golden-debug-config` | `reference-node-fullstack` | `debug-config` | `passed` | `passed` | PASS |
| `golden-debug-artifacts` | `reference-node-fullstack` | `debug-artifacts` | `passed` | `passed` | PASS |
| `golden-runtime-app-starts` | `reference-node-fullstack` | `runtime-app-starts` | `passed` | `passed` | PASS |
| `golden-runtime-health` | `reference-node-fullstack` | `runtime-health` | `passed` | `passed` | PASS |
| `golden-runtime-frontend` | `reference-node-fullstack` | `runtime-frontend` | `passed` | `passed` | PASS |
| `golden-runtime-frontend-api` | `reference-node-fullstack` | `runtime-frontend-api` | `passed` | `passed` | PASS |
| `golden-runtime-crud` | `reference-node-fullstack` | `runtime-crud` | `passed` | `passed` | PASS |
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
| `runtime-app-crashes-on-boot` | `reference-node-fullstack` | `runtime-app-starts` | `appExitedBeforeListening` | `appExitedBeforeListening` | PASS |
| `runtime-crud-not-attempted-when-app-dead` | `reference-node-fullstack` | `runtime-crud` | `runtimeNotAttempted` | `runtimeNotAttempted` | PASS |
| `runtime-health-not-attempted-when-app-dead` | `reference-node-fullstack` | `runtime-health` | `runtimeNotAttempted` | `runtimeNotAttempted` | PASS |
| `runtime-health-returns-500` | `reference-node-fullstack` | `runtime-health` | `healthEndpointUnhealthy` | `healthEndpointUnhealthy` | PASS |
| `runtime-health-route-missing` | `reference-node-fullstack` | `runtime-health` | `healthEndpointUnhealthy` | `healthEndpointUnhealthy` | PASS |
| `runtime-frontend-not-served` | `reference-node-fullstack` | `runtime-frontend` | `frontendNotServed` | `frontendNotServed` | PASS |
| `runtime-frontend-calls-missing-route` | `reference-node-fullstack` | `runtime-frontend-api` | `frontendApiRouteMissing` | `frontendApiRouteMissing` | PASS |
| `runtime-health-collection-removed` | `reference-node-fullstack` | `runtime-health` | `passed` | `passed` | PASS |
| `runtime-crud-write-not-persisted` | `reference-node-fullstack` | `runtime-crud` | `crudRoundTripLost` | `crudRoundTripLost` | PASS |
| `runtime-frontend-api-unresolvable-url` | `reference-node-fullstack` | `runtime-frontend-api` | `frontendApiCallsUnresolvable` | `frontendApiCallsUnresolvable` | PASS |
| `runtime-frontend-api-nothing-called` | `reference-node-fullstack` | `runtime-frontend-api` | `frontendMakesNoApiCalls` | `frontendMakesNoApiCalls` | PASS |
| `runtime-app-starts-never-scaffolded` | `reference-node-fullstack` | `runtime-app-starts` | `runtimeNotAttempted` | `runtimeNotAttempted` | PASS |
| `golden-service-fidelity` | `reference-node-multiservice` | `service-fidelity` | `passed` | `passed` | PASS |
| `golden-datastore-fidelity` | `reference-node-multiservice` | `datastore-fidelity` | `passed` | `passed` | PASS |
| `fidelity-planned-service-dropped` | `reference-node-multiservice` | `service-fidelity` | `plannedServiceMissing` | `plannedServiceMissing` | PASS |
| `fidelity-service-invented` | `reference-node-multiservice` | `service-fidelity` | `unplannedServiceScaffolded` | `unplannedServiceScaffolded` | PASS |
| `fidelity-frontend-missing` | `reference-node-multiservice` | `service-fidelity` | `frontendMissingFromScaffold` | `frontendMissingFromScaffold, plannedServiceMissing, serviceFrameworkMismatch` | PASS |
| `fidelity-frontend-invented` | `reference-node-multiservice` | `service-fidelity` | `frontendNotPlanned` | `frontendNotPlanned, unexpectedFrontendSection` | PASS |
| `fidelity-language-swapped` | `reference-node-multiservice` | `service-fidelity` | `serviceLanguageMismatch` | `serviceLanguageMismatch` | PASS |
| `fidelity-framework-swapped` | `reference-node-multiservice` | `service-fidelity` | `serviceFrameworkMismatch` | `serviceFrameworkMismatch` | PASS |
| `fidelity-plan-declares-no-services` | `reference-node-multiservice` | `service-fidelity` | `planDeclaresNoServices` | `planDeclaresNoServices` | PASS |
| `fidelity-datastore-import-swapped` | `reference-node-multiservice` | `datastore-fidelity` | `plannedDatastoreNotWired` | `plannedDatastoreNotWired, unplannedDatastoreWired` | PASS |
| `fidelity-datastore-invented` | `reference-node-multiservice` | `datastore-fidelity` | `unplannedDatastoreWired` | `unplannedDatastoreWired` | PASS |
| `fidelity-datastore-dependency-dropped` | `reference-node-multiservice` | `datastore-fidelity` | `datastoreDependencyMissing` | `datastoreDependencyMissing` | PASS |
| `fidelity-resource-never-wired` | `reference-node-multiservice` | `datastore-fidelity` | `plannedResourceNotWired` | `plannedResourceNotWired` | PASS |
| `fidelity-services-required-table-unreadable` | `reference-node-multiservice` | `datastore-fidelity` | `plannedResourcesUnreadable` | `plannedResourcesUnreadable` | PASS |
| `golden-service-fidelity` | `reference-python-api` | `service-fidelity` | `passed` | `passed` | PASS |
| `golden-datastore-fidelity` | `reference-python-api` | `datastore-fidelity` | `passed` | `passed` | PASS |
| `fidelity-datastore-swapped-python` | `reference-python-api` | `datastore-fidelity` | `unplannedDatastoreWired` | `plannedDatastoreNotWired, unplannedDatastoreWired` | PASS |
| `fidelity-datastore-unwired-python` | `reference-python-api` | `datastore-fidelity` | `plannedDatastoreNotWired` | `plannedDatastoreNotWired, unplannedDatastoreWired` | PASS |
| `fidelity-nothing-scaffolded-python` | `reference-python-api` | `datastore-fidelity` | `noServicesScaffolded` | `noServicesScaffolded` | PASS |
| `fidelity-orm-owns-the-driver-python` | `reference-python-api` | `datastore-fidelity` | `passed` | `passed` | PASS |
| `golden-service-fidelity` | `reference-dotnet-api` | `service-fidelity` | `passed` | `passed` | PASS |
| `golden-datastore-fidelity` | `reference-dotnet-api` | `datastore-fidelity` | `passed` | `passed` | PASS |
| `fidelity-datastore-swapped-dotnet` | `reference-dotnet-api` | `datastore-fidelity` | `plannedDatastoreNotWired` | `plannedDatastoreNotWired, unplannedDatastoreWired` | PASS |
| `fidelity-orm-owns-the-driver-dotnet` | `reference-dotnet-api` | `datastore-fidelity` | `passed` | `passed` | PASS |
| `golden-service-fidelity` | `reference-go-unsupported` | `service-fidelity` | `ecosystemNotSupported` | `ecosystemNotSupported` | PASS |
| `golden-datastore-fidelity` | `reference-go-unsupported` | `datastore-fidelity` | `ecosystemNotSupported` | `ecosystemNotSupported` | PASS |
| `golden-debug-breakpoint` | `debug-probe-verdict` | `debug-breakpoint` | `passed` | `passed` | PASS |
| `debug-breakpoint-launch-config-invalid` | `debug-probe-verdict` | `debug-breakpoint` | `launchConfigInvalid` | `launchConfigInvalid` | PASS |
| `debug-breakpoint-app-failed-to-start` | `debug-probe-verdict` | `debug-breakpoint` | `appFailedToStart` | `appFailedToStart` | PASS |
| `debug-breakpoint-never-hit` | `debug-probe-verdict` | `debug-breakpoint` | `breakpointNotHit` | `breakpointNotHit` | PASS |
| `debug-breakpoint-pattern-miss-blames-harness` | `debug-probe-verdict` | `debug-breakpoint` | `harnessFault:patternMatchedNothing` | `harnessFault:patternMatchedNothing` | PASS |
| `debug-breakpoint-probe-error-blames-harness` | `debug-probe-verdict` | `debug-breakpoint` | `harnessFault:probeError` | `harnessFault:probeError` | PASS |
| `debug-breakpoint-unknown-outcome-blames-harness` | `debug-probe-verdict` | `debug-breakpoint` | `harnessFault:unknownOutcome` | `harnessFault:unknownOutcome` | PASS |
| `debug-breakpoint-schema-drift-blames-harness` | `debug-probe-verdict` | `debug-breakpoint` | `harnessFault:schemaDrift` | `harnessFault:schemaDrift` | PASS |
| `debug-breakpoint-missing-verdict-blames-harness` | `debug-probe-verdict` | `debug-breakpoint` | `harnessFault:noVerdict` | `harnessFault:noVerdict` | PASS |
| `golden-no-scaffold` | `unapproved-plan-refusal` | `no-scaffold` | `passed` | `passed` | PASS |
| `golden-project-builds` | `unapproved-plan-refusal` | `project-builds` | `noPackagesFound` | `noPackagesFound, frontendNotScaffolded` | PASS |
| `project-builds-unparseable-only-reports-the-real-problem` | `unapproved-plan-refusal` | `project-builds` | `unparseablePackageManifest` | `unparseablePackageManifest, frontendNotScaffolded` | PASS |
| `project-builds-unparseable-only-not-called-empty` | `unapproved-plan-refusal` | `project-builds` | `!noPackagesFound` | `unparseablePackageManifest, frontendNotScaffolded` | PASS |
| `no-scaffold-nested-source-appears` | `unapproved-plan-refusal` | `no-scaffold` | `scaffoldedFromUnapprovedPlan` | `scaffoldedFromUnapprovedPlan` | PASS |
| `no-scaffold-root-manifest-appears` | `unapproved-plan-refusal` | `no-scaffold` | `scaffoldedFromUnapprovedPlan` | `scaffoldedFromUnapprovedPlan` | PASS |
| `golden-integration-plan` | `api-only-no-datastore` | `integration-plan` | `passed` | `passed` | PASS |
| `golden-iac-compiles` | `reference-iac-bicep` | `iac-compiles` | `passed` | `passed` | PASS |
| `iac-compiles-no-template-is-not-a-pass` | `reference-iac-bicep` | `iac-compiles` | `noIacFound` | `noIacFound` | PASS |
| `iac-compiles-missing-manifest-is-reported` | `reference-iac-bicep` | `iac-compiles` | `missingScaffoldManifest` | `missingScaffoldManifest` | PASS |
| `iac-compiles-unparseable-manifest-is-reported` | `reference-iac-bicep` | `iac-compiles` | `unparseableScaffoldManifest` | `unparseableScaffoldManifest` | PASS |
| `iac-compiles-unparseable-manifest-not-called-missing` | `reference-iac-bicep` | `iac-compiles` | `!missingScaffoldManifest` | `unparseableScaffoldManifest` | PASS |
| `iac-compiles-suppressed-blocking-diagnostic-is-reported` | `reference-iac-bicep` | `iac-compiles` | `suppressedBlockingDiagnostic` | `suppressedBlockingDiagnostic` | PASS |
| `iac-compiles-sanctioned-suppression-is-allowed` | `reference-iac-bicep` | `iac-compiles` | `!suppressedBlockingDiagnostic` | `passed` | PASS |
| `iac-compiles-build-check-synonym-is-accepted` | `reference-iac-bicep` | `iac-compiles` | `!missingBicepBuildCheck` | `passed` | PASS |
| `iac-compiles-unvalidated-status-is-reported` | `reference-iac-bicep` | `iac-compiles` | `iacNotValidated` | `iacNotValidated` | PASS |
| `iac-compiles-self-reported-build-failure-is-reported` | `reference-iac-bicep` | `iac-compiles` | `bicepBuildSelfReportedFailure` | `bicepBuildSelfReportedFailure` | PASS |
| `iac-compiles-absent-build-check-is-reported` | `reference-iac-bicep` | `iac-compiles` | `missingBicepBuildCheck` | `missingBicepBuildCheck` | PASS |
| `iac-compiles-terraform-is-a-coverage-gap-not-a-pass` | `reference-iac-bicep` | `iac-compiles` | `terraformNotSupported` | `terraformNotSupported` | PASS |
| `iac-compiles-terraform-is-not-called-missing` | `reference-iac-bicep` | `iac-compiles` | `!noIacFound` | `terraformNotSupported` | PASS |

