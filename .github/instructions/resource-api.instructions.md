---
description: 'Preserve Azure Resources client contracts, host API authentication, and legacy extension compatibility.'
applyTo: "api/**, src/api/**, src/hostapi.*.ts, src/utils/wrapFunctionsInTelemetry.ts, test/api/**, test/wrapFunctionsInTelemetry.test.ts"
---

# Azure Resources API

## Follow both sides of the contract

- Public types and client helpers live in `api/src`; implementations live in `src/api` and are
  assembled in `src/extension.ts`. Trace the client helper, requested protocol version, host factory,
  telemetry wrapper, and legacy adapter before changing a signature or return value.
- Do not conflate the extension version, the `@microsoft/vscode-azureresources-api` npm version,
  and API protocol versions. Activation currently assembles legacy compatibility, v2 resources,
  the temporary v3 DocumentDB migration signal, and the v4 authentication layer. Preserve existing
  clients and their version negotiation rather than removing an older path as unused.
- Keep the v3 migration signal separate from the v2 resource contract; it is deliberately not a
  general-purpose successor API. Do not infer consumer capability from the extension version.
- `src/api/compatibility` bridges older `AzExtTreeItem` clients to the resource/branch-provider model.
  Check picker, reveal, refresh, registration, and workspace-resource behavior when changing it.

## Authentication and wrapping

- The v4 host factory is `src/api/auth/createAuthApiFactory.ts`. Keep credential verification,
  client-extension identity normalization, and session creation ahead of protected API access.
  Never log credentials or bypass verification to make a client integration work.
- Use the existing credential-manager and client-provider dependency seams for auth tests; custom
  test providers must not leak into production activation.
- `createWrappedAzureResourcesExtensionApi.ts` distinguishes synchronous registrations from async
  operations and binds methods before wrapping them. Preserve calling-extension attribution,
  protocol-version telemetry, `this`, return values, and error semantics when adding a member.
- Keep provider registrations disposable and preserve lazy activation through
  `ResourceGroupsExtensionManager` and the resource/branch-provider managers. Do not eagerly
  activate every contributing extension to resolve one resource type.

## Validation and generated declarations

- Cover contract changes in `test/api`: include relevant v1 compatibility, resource/workspace
  provider, wrapper, API acquisition, or auth tests. Use `TestBranchDataProvider` and existing mocks
  rather than requiring another installed Azure extension or a real subscription.
- Use the root build/type-check and extension test runner for host behavior. When changing the
  published client surface, also run `npm run api-extractor` from the root; it runs the API package's
  ESM/CJS builds and generates the rolled-up declaration using `api/api-extractor.json`.
- Never import implementation types from `api/docs`; ESLint explicitly rejects that path. Edit
  `api/src`, not generated declarations under `api/dist` or `api/out`.
- Follow `api/CONTRIBUTING.md` for a release-prep change: bump the API package version, update
  `api/CHANGELOG.md`, generate declarations, then copy `api/dist/vscode-azureresources-api.d.ts` to
  `api/docs`. Do not bump versions or regenerate documentation snapshots for unrelated host fixes.
