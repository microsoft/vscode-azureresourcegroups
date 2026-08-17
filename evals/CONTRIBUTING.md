# Contributing to Copilot on Rails evaluations

This guide explains how to run the complete evaluation system, extend its coverage, change its
graders, and turn evaluation evidence into product changes. Start with the smallest applicable tier
and preserve the exact scenario, model, arm, attempt, and evaluator provenance whenever comparing
results.

## What the complete suite runs

The evaluation system has three distinct layers:

| Layer | Purpose | Model calls | ACA Sandboxes |
|---|---|---:|---:|
| Deterministic contracts | Validate schemas, generated Vally specs, release policy, graders, and one-fault mutations | No | No |
| ACA grader certification | Prove the executable graders against a hand-authored passing project and controlled failures | No | Yes |
| Paired Vally E2E | Generate and validate projects for both Copilot on Rails and generic Copilot | Yes | Yes |

The paired Vally experiments already include both arms:

- `rails` is the normal Copilot on Rails end-to-end journey.
- `baseline-controlled` is generic Copilot in an empty workspace, using the same scenario, model,
  endpoint, attempt, and validation.

Do not run the standalone baseline command in addition to a Vally experiment unless you are
debugging the baseline implementation. It would duplicate paid work without producing a new matched
pair.

The standard order is:

1. Run deterministic contracts and offline grader certification.
2. Run ACA grader certification. Stop if it fails; product/model results are not trustworthy.
3. Dry-run the selected Vally experiment.
4. Run the paired Vally experiment. This runs Rails and baseline.
5. Aggregate the durable evidence and inspect the release assessment.
6. Verify exact-owner sandbox cleanup.

Daily CI runs the two-scenario, primary-model compatibility pilot: two scenarios x two arms x one
attempt = four paid trials. Weekly CI runs four scenarios x two arms x two attempts for each of the
three pinned models = 48 paid trials. The local release experiment is 20 scenarios x two arms x
three attempts = 120 paid trials.

## One-time local setup

### Toolchain

- Node.js 22
- npm 11.11.1
- Azure CLI
- An organizational Microsoft Entra account
- Access to an ACA Sandbox Group
- A GitHub token authorized for the Copilot endpoint used by the evaluator

Install dependencies:

```bash
npm install --global npm@11.11.1
npm ci
```

Install the ACA CLI on Linux or macOS:

```bash
curl -fsSL https://aka.ms/aca-cli-install | sh
```

On Windows PowerShell:

```powershell
irm https://aka.ms/aca-cli-install-ps | iex
```

This same install path is also used inside sandboxes and containers for agent-driven self-installs.

Check cached authentication before opening an interactive sign-in:

```bash
aca --version
az account show -o none 2>/dev/null || az login
aca auth status >/dev/null 2>&1 || aca auth login
aca doctor
```

`aca doctor` must be green before running an ACA tier. It verifies the subscription, resource
group, default sandbox group, region, and `Container Apps SandboxGroup Data Owner` role.

### Sandbox-group access

Prefer the team's existing evaluation group. An administrator grants another teammate access with:

```bash
aca sandboxgroup role create \
  --role "Container Apps SandboxGroup Data Owner" \
  --principal-id "$(az ad user show --id <teammate-upn> --query id -o tsv)"
```

To create a separate evaluation group instead:

```bash
az account show -o none 2>/dev/null || az login
aca auth status >/dev/null 2>&1 || aca auth login
aca sandboxgroup create --name <group> --location <region> --set-config
aca doctor
```

`aca sandboxgroup create` grants the caller the Data Owner role. Use `role create` only for
additional principals. `--set-config` is required so evaluator commands resolve the group without a
flag on every call.

The evaluator uses checked-in declarative manifests. The reproducible CI/CD pattern is:

```bash
aca sandbox init
aca sandbox validate --file sandbox.yaml
aca sandbox apply --file sandbox.yaml
```

Use `aca sandbox init` only when adding a new manifest. Edit its `disk`, `resources`,
`lifecycle.autoSuspendPolicy`, `egressPolicy`, and any required `ports`, `env`, or `labels`. Use
`aca sandbox schema` for editor autocomplete. The manifest pattern is recommended for CI/CD and
reproducibility; do not replace it with imperative sandbox creation in evaluator code.

### Local environment

Select the evaluation subscription and configure the ACA defaults consumed by `aca doctor`. Export
the Copilot token without writing it to the repository:

```bash
export GH_TOKEN="<Copilot-authorized GitHub token>"
export COR_EVAL_OWNER_ID="yourname-local"
```

`COR_EVAL_OWNER_ID` must be lowercase alphanumeric/hyphen text and at most 63 characters. It lets
the evaluator and cleanup logic identify only sandboxes owned by this run.

## Run the suite locally

### 1. Deterministic contracts

```bash
npm run build:check
npm run lint
npm run eval:cor:thresholds:validate
npm run eval:cor:spike:dry
npm run eval:cor:graders:certify
npm run eval:cor:vally:native:check
npm run eval:cor:vally:native:lint
npm run eval:cor:vally:native:oracle
npm run eval:cor:vally:native:test
npm run eval:cor:vally:native:pilot:dry
```

These commands make no model calls and create no Azure resources.

### 2. ACA grader certification

```bash
aca sandbox validate --file evals/sandbox.yaml
aca sandbox validate --file evals/sandbox-python.yaml
aca sandbox validate --file evals/sandbox-dotnet.yaml
npm run eval:cor:graders:certify:aca
```

This creates disposable sandboxes but makes no model calls. It proves real build, generated-test,
runtime, browser, accessibility, persistence, debugger-readiness, and cleanup behavior. Reports are
written under `evals/results/grader-certification/`.

To diagnose one certification case:

```bash
npm run eval:cor:graders:certify:aca -- --case golden-local-runtime
```

### 3. Paired Rails and baseline E2E

Always inspect the dry run first:

```bash
npm run eval:cor:vally:native:pilot:dry
```

Run the four-trial primary-model pilot:

```bash
npm run eval:cor:vally:paid:pilot:gpt-5-6-sol
```

That one command runs both the normal Rails E2E arm and the controlled baseline arm. To test the
full pinned model set, run the corresponding Claude Sonnet 5 and GPT-5.4-mini pilot aliases listed
in `evals/README.md`.

Aggregate one or more experiment output directories:

```bash
npm run eval:cor:vally:native:report -- \
  --experiment-dir evals/results/vally-native/compatibility-pilot-gpt-5-6-sol \
  --output evals/results/vally-native-report
```

Read these files first:

- `report.md`: human-readable outcomes, matched Rails/baseline comparison, one row per run,
  failed-gate evidence, artifact links, and release recommendation.
- `vally-native-report.json`: complete machine-readable report.
- `experiment-input-manifest.json`: every accepted evidence bundle and cleanup status.
- Per-trial `artifacts/native-summary.json`: scenario/model/arm result.
- Per-trial `artifacts/cor-validation.json`: authoritative gate evidence.
- Per-trial `artifacts/validation-manifest.json`: provenance and cleanup verification.

Generated test and lint failures do not suppress later local evidence. The attempt remains failed,
while integration, runtime, browser, persistence, and debugger gates continue when build/setup
prerequisites are available. Read each gate independently; for example, `test: failed` and
`debugger: passed` is a valid and actionable result.

`candidate` means every configured release gate passed. `hold` means complete evidence exists but
one or more quality gates failed. `insufficient_evidence` means required coverage or external proof
is missing; it is not a passing result.

### Cleanup check

The evaluator deletes each sandbox by exact ID and the workflow performs a second exact-owner
sweep. Confirm no sandboxes remain for your owner label:

```bash
aca sandbox list -l "owner-id=$COR_EVAL_OWNER_ID" -o json
```

If a failed run leaves a sandbox, preserve it first only when it contains state needed for
investigation:

```bash
aca sandbox snapshot --id "$SANDBOX_ID" --name <diagnostic-snapshot>
aca sandbox delete --id "$SANDBOX_ID" --yes
```

Deletion is destructive. Never use a broad selector or delete sandboxes owned by another run.

## Configure repository CI

The workflow is `.github/workflows/copilot-on-rails-evals.yml`.

Repository variables:

- `COR_EVAL_DAILY_ENABLED=true` to enable the nightly primary-model pilot.
- `COR_EVAL_WEEKLY_ENABLED=true` to enable the weekly three-model representative run.
- `COR_EVAL_RESOURCE_GROUP`
- `COR_EVAL_SANDBOX_GROUP`
- `COR_EVAL_REGION`

Repository secrets:

- `COR_EVAL_AZURE_CLIENT_ID`
- `COR_EVAL_AZURE_TENANT_ID`
- `COR_EVAL_AZURE_SUBSCRIPTION_ID`
- `COR_EVAL_COPILOT_GITHUB_TOKEN`

The Azure identity needs `Container Apps SandboxGroup Data Owner` on the configured group. Pull
requests run only deterministic contracts. Daily and weekly jobs run ACA grader certification
before paired model experiments and upload experiment plus cleanup evidence even when trials fail.

Dispatch manually:

```bash
gh workflow run copilot-on-rails-evals.yml -f tier=contracts
gh workflow run copilot-on-rails-evals.yml -f tier=daily
gh workflow run copilot-on-rails-evals.yml -f tier=weekly
```

The `release` workflow currently fails closed before paid calls because current provenance-bound
real VS Code breakpoint and explicitly authorized live-deployment integrations are not yet wired
into that workflow.

## Add or modify a scenario

Scenario sources live in `evals/scenarios/*.json`. A scenario owns the user intent and evaluator
acceptance contract; generated Vally YAML is not the source of truth.

1. Copy the closest scenario and give it a unique kebab-case `id`.
2. Write a standalone `baselinePrompt` that does not mention Rails or assume prior context.
3. Set explicit archetype, frontend, backend, database, auth, and complexity tags.
4. Keep `requirementsAnswers.dataStores` aligned with the database tag.
5. Define build, generated-test, lint, and timeout requirements.
6. Add evaluator-owned local probes where the project should run locally.
7. For a UI, add browser actions, assertions, and an accessibility threshold.
8. Add persistence or storage-event contracts only when the scenario requires those behaviors.
9. Add debugger parity source/trigger data when applicable.
10. Regenerate Vally specs; never hand-edit generated experiment YAML.

```bash
npm run eval:cor:vally:native:generate
npm run eval:cor:vally:native:check
npm run eval:cor:vally:native:lint
npm run eval:cor:vally:native:test
npm run eval:cor:graders:certify
```

If the corpus size changes, update the explicit corpus-size contract and release thresholds in the
same change. Add new scenarios to the compatibility or representative sets only deliberately; those
sets control recurring cost.

## Add or modify a grader

Artifact validators live in `evals/src/artifacts/`. Executable ACA validators live in
`SandboxProjectValidator.ts`, `SandboxLocalRuntimeValidator.ts`, and
`SandboxVsCodeParityValidator.ts`. Vally's authoritative aggregation bridge lives under
`evals/vally/plugins/cor-graders/`.

Every grader change requires:

1. A stable, specific failure code.
2. A passing golden case.
3. A one-fault mutation that triggers exactly the intended failure.
4. Evidence that unrelated gates continue to pass.
5. Fail-closed behavior when required evidence is absent.
6. A focused unit test.
7. Offline certification when possible; ACA certification when behavior requires real execution.
8. Updates to gate applicability, reporting, thresholds, and documentation when the release
   contract changes.

Add project-level mutations to `evals/grader-certification/manifest.json`. Modify the hand-authored
reference project only to model intended valid behavior; do not weaken it merely to make a grader
pass.

Run:

```bash
npm run eval:cor:graders:certify
npm run eval:cor:graders:certify:aca
npm run eval:cor:vally:native:oracle
npm run eval:cor:vally:native:test
```

## Turn results into project changes

Treat evidence in this order:

1. **Grader certification failure:** fix the evaluator or fixture first. Do not infer product
   quality from model trials while the oracle is uncertified.
2. **Infrastructure failure:** fix or rerun the ACA/Copilot environment. Keep it outside the product
   quality denominator.
3. **Harness failure:** repair evaluator orchestration, provenance, evidence collection, or cleanup.
4. **Product failure:** change Rails agents, references, tools, templates, or workflow code.

For a product failure:

1. Locate the exact model, scenario, arm, attempt, failed stage, and failure code in `report.md`.
2. Open that trial's `reports/run-diagnostics.md` first. It distinguishes failed gates from dependent
   gates that were not attempted and includes the failing command, stdout/stderr excerpt, repair
   usage, and recommended action. Use `run-result.json` for the complete unabridged stage evidence.
3. Reproduce the smallest matching scenario; do not start with the full release matrix.
4. Determine whether the same-model baseline passed.
5. Fix the product contract or implementation, not the grader, unless the expected behavior is
   demonstrably wrong.
6. Add a deterministic regression test for the failure.
7. Run offline contracts and ACA grader certification.
8. Rerun the exact paired scenario/model.
9. Expand to the compatibility pilot, then representative tier, and only then the release corpus.

Interpret matched arms carefully:

- Baseline passes and Rails fails: high-priority Rails regression.
- Rails passes and baseline fails: evidence of Rails value for that capability.
- Both fail: likely a difficult or unsupported capability; inspect failure stages before changing
  the product.
- Both pass: compare first-pass success, repair usage, latency, tokens, and nano-AIU cost.

Never hide a recurring product failure by weakening an acceptance contract or reclassifying it as
infrastructure. Any intentional behavior change must update the scenario, grader certification,
release threshold, and product implementation together.

## Review checklist

- Scenario and evaluator sources changed together where required.
- Generated Vally specs have no drift.
- Golden grader fixture passes.
- Each new failure condition has a one-fault mutation and exact code.
- Rails and baseline use the same model, scenario, endpoint, and attempt.
- Reports retain candidate commit, asset hash, evaluation-definition hash, and cleanup proof.
- Paid trial count and expected cost are stated in the pull request.
- No sandbox, token, credential, generated workspace, or evaluation result is committed.
- Product fixes include a focused regression test and an exact paired rerun.
