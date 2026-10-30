# Azure Resources extension guidance

This repository implements **Azure Resources**, not just resource-group CRUD. It hosts shared
resource trees, account/subscription selection, APIs consumed by other Azure extensions, Cloud Shell,
and Create New Project with Copilot (Copilot on Rails).

Use [AGENTS.md](../AGENTS.md) to locate owners and entry points. Read the matching
`.github/instructions/*.instructions.md` before changing a subsystem. The existing Copilot on Rails
documentation and artifact-security instructions remain applicable alongside the newer guides.

## Implementation and bug fixes

- Trace the affected contribution in `package.json` through registration in `src/extension.ts` or
  `src/commands/registerCommands.ts` to its handler, provider, and refresh/output path. Check callers
  in `api/src` and compatibility adapters before changing shared behavior.
- Make the smallest **complete** fix at the responsible layer. Preserve unrelated work and avoid
  opportunistic cleanup, new frameworks, and speculative abstractions. Reuse an existing helper
  before introducing another implementation.
- Establish the concrete trigger and expected behavior before editing. Add a focused regression
  covering the failing case and a nearby preserved behavior; test through the public boundary when
  the bug is in registration, selection, wrapping, or compatibility.
- Keep command IDs, menu/context expressions, settings, view IDs, and activation events in sync
  with handlers. A context menu working is not enough if the same command can run from the command
  palette with no selected node.
- Use Azure Tools action contexts, `registerCommand`, `callWithTelemetryAndErrorHandling`,
  `AzureWizard`, subscription-selection helpers, and activity helpers where that flow already uses
  them. Preserve cancellation and error propagation; do not convert failures into successful empty
  results or add duplicate notifications.
- Keep TypeScript strict. Narrow untrusted values and optional API fields rather than adding `any`,
  unchecked casts, non-null assertions, or compiler/linter exemptions to hide a problem.
- Follow the surrounding localization mechanism: `src/utils/localize.ts` for existing `vscode-nls`
  callers, `vscode.l10n.t` where already used, and `package.nls.json` for manifest strings.
- Preserve Windows, macOS, Linux, remote-workspace, and supported VS Code web/Cloud Shell paths.
  Use `vscode.Uri` and `workspace.fs` for workspace resources where appropriate; do not turn a URI
  into a local path without establishing that it is a local file. Keep platform-specific process,
  shell, and IPC handling at existing boundaries.
- Treat credentials, access tokens, connection strings, user project contents, and sensitive
  resource data as private. Do not put them in telemetry, diagnostic exports, output, or errors.
  Use existing masking/context helpers and record safe metadata rather than raw payloads.
- Own and dispose new event listeners, watchers, providers, and output channels. Avoid adding
  blocking network work to activation; preserve intentional lazy imports and provider activation.

## Commands and validation

Run commands from the repository root unless a different directory is stated. `.nvmrc` selects
Node 22.18; `api` and `evals` have separate manifests and lockfiles.

| Purpose | Existing command / behavior |
| --- | --- |
| Bundle and extension type-check | `npm run build` runs `build:esbuild` then `build:check` |
| Extension type-check only | `npm run build:check` uses `tsgo --noEmit` |
| Lint and agent drift | `npm run lint` runs ESLint with zero warnings, then `eval:drift` |
| Extension tests | `npm test` invokes `vscode-test`; `.vscode-test.mjs` delegates to the Azure Tools engineering configuration |
| Package extension | `npm run package` invokes `vsce package --githubBranch main` |
| Generate API declarations | `npm run api-extractor` delegates to the `api` package |
| Agent asset contracts | `npm run eval:drift` |

- Build before running extension tests. Prefer the smallest relevant test selection supported by
  the installed VS Code test runner; do not assume these tests run under standalone Mocha or Node.
  `test/global.test.ts` initializes the extension and `TestUserInput`.
- Reuse `test/api/mockServiceFactory.ts`, `MockAzureSubscriptionProvider`, and the test API accessed
  through `test/utils/testApiAccess.ts`. Restore changed settings, environment variables, and
  overrides. Do not turn ordinary regression tests into live Azure calls.
- Live tests under `test/nightly` are gated by the setup in `test/global.test.ts`; they can require
  credentials and create resources. Do not enable them implicitly.
- The root TypeScript project excludes `evals` and the Copilot on Rails React views. A passing
  `build:check` does not prove either is type-correct; use their scoped validation guidance.
- Run checks relevant to the change, not `npm run all` by default: that script also installs,
  packages, and runs the full extension tests. For prose-only edits, inspect links, paths, command
  names, instruction scopes, and the diff; no extension build is needed.
- Do not hand-edit generated `dist`/`out` files or bundles. Edit source and use the owning generator.
  API documentation snapshots and the agent asset lock have explicit update procedures in their
  scoped guides; dependency-lock changes should accompany intentional dependency changes.

## Pull request review

- Report actionable defects introduced by the change, not style preferences or hypothetical
  improvements. Trace each finding to a real caller, supported configuration, or reproducible input.
- For each finding, give severity (`P0` critical, `P1` high, `P2` normal, `P3` low), the smallest
  useful changed file/line range, the triggering condition, observable impact, and the smallest
  viable correction. Explain why existing guards or tests do not prevent it.
- Prioritize wrong-account/subscription operations, API/client compatibility breaks, missing
  destructive-action confirmation, credential disclosure, stale or misidentified tree nodes,
  broken reload/resume behavior, and untrusted artifact-to-command/HTML/path flows.
- Distinguish a confirmed bug from uncertainty. Do not claim tests ran when only source was read.
  If no concrete defect is established, say so without inventing findings.
