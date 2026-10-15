---
description: 'Preserve the published Azure Resources API, authenticated host API, and legacy client compatibility.'
applyTo: "api/**,src/api/**,src/AzExtWrapper.ts,src/exportAuthRecord.ts,src/hostapi.v2.internal.ts,src/hostapi.v4.internal.ts,src/testApi.ts,src/extension.ts,test/api/**,test/utils/testApiAccess.ts"
---

# API and compatibility instructions

## Ownership

- `api/src/**`: source of the published `@microsoft/vscode-azureresources-api` package.
- `api/src/resources/**`: resource, branch data provider, tree provider, reveal, focus, and selection
  contracts.
- `api/src/auth/**`: credential/session request protocol used to obtain protected host APIs.
- `src/api/createAzureResourcesHostApi.ts`: host implementation that joins provider managers and tree
  providers.
- `src/api/createWrappedAzureResourcesExtensionApi.ts`: immutable API shape and telemetry wrappers.
- `src/api/auth/**`: authenticated v4 factory and session verification.
- `src/api/compatibility/**`: v1 tree/resolver/workspace adapters backed by the current resource API.
- `src/extension.ts`: API factory/version registration and the `VSCODE_RUNNING_TESTS`-gated `99.0.0`
  API.
- `test/api/**`: client/host boundary, authentication, compatibility, provider, reveal, focus, and
  workspace-resource coverage.

## Contract rules

- Keep published `api/src/**` types independent from extension implementation details. Product behavior
  belongs in `src/api/**`, not the client package.
- Keep API adapters thin so commands, trees, API callers, and tests use the same provider and product
  logic.
- Preserve old API versions and compatibility ID conversion unless an explicit removal/migration plan
  covers every known client extension.
- Preserve the authenticated API handshake: validate client identity/session data, return only requested
  supported API versions, and never log credentials or auth records.
- Register/unregister providers symmetrically and return a working `Disposable`. Provider changes must
  propagate through the manager and affected tree without leaking listeners.
- Keep telemetry wrappers around public callbacks, including the bounded calling extension ID and API
  version. Do not add API arguments, resource IDs, or callback results to telemetry.
- Public async methods must reject when the caller needs to observe failure; do not turn errors into
  success-shaped `undefined` values.
- Keep the test API gated by `VSCODE_RUNNING_TESTS`; production code must never import or depend on it.

## Published API changes

A public contract change requires all of the following in the same change:

- Update the source types and host implementation.
- Review API version and backward compatibility.
- Add or update `test/api/**` boundary coverage.
- Update `api/CHANGELOG.md` and applicable `api/README.md` documentation.
- Run `npm run api-extractor` and update the checked-in rolled-up declaration used by the API docs,
  following `api/CONTRIBUTING.md`.
