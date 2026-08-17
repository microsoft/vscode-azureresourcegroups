# Copilot on Rails evaluations

For setup, execution order, scenario/grader authoring, result interpretation, and the workflow for
turning failures into product changes, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Vally-first ACA operator commands

The Vally-native specs are deterministically generated from the 20 checked-in scenarios. Regenerate
after changing the corpus, or use the check in review and CI. These commands are offline:

```sh
npm run eval:cor:vally:native:generate
npm run eval:cor:vally:native:check
npm run eval:cor:vally:native:lint
npm run eval:cor:vally:native:oracle
npm run eval:cor:vally:native:test
npm run eval:cor:vally:native:pilot:dry
```

`native:lint` is strict and loads the authoritative grader bridge. The oracle re-grades golden
custom metrics without an agent. Tests cover generation drift, generated specs, the executor,
backend cleanup, and fail-closed grading. The pilot dry-run resolves both experiment variants and
their schedule but makes no model call and creates no ACA sandbox.

## Grader certification corpus

The Vally oracle proves that authoritative evidence is aggregated correctly. The separate
grader-certification corpus proves that the underlying project validators recognize real project
behavior. Its hand-authored reference project lives under
`evals/grader-certification/reference-node-fullstack/` and is intentionally dependency-free.

```sh
# PR-safe: artifact contracts, target discovery, and one-fault mutations.
npm run eval:cor:graders:certify

# Nightly: real ACA build, test, runtime, browser, accessibility, persistence,
# debugger-readiness, and cleanup evidence.
npm run eval:cor:graders:certify:aca

# Diagnose one ACA case without rerunning the whole corpus.
npm run eval:cor:graders:certify:aca -- --case golden-local-runtime
```

`evals/grader-certification/manifest.json` declares every validator, mutation, expected failure
code, and execution tier. The golden workspace must pass every applicable validator. Each mutation
changes exactly one condition and must produce its declared failure code and, for build/test
mutations, the exact failing command. Missing build evidence fails closed as `noBuildTargets`.
Reports are written to `evals/results/grader-certification/` as JSON and Markdown.

The contracts workflow runs the offline corpus. Daily and weekly jobs run the ACA corpus before
model experiments. This certification does not replace Vally grading; it verifies the executable
oracles whose results Vally consumes.

> **Paid-call warning:** every command below invokes coding models and creates ACA sandbox work.
> Confirm Azure/Copilot credentials, quotas, expected trial count, and the dry-run plan first.

A direct, single Rails trial proves the executor and grader JavaScript bridges independently of the
experiment API:

```sh
vally eval \
  --eval-spec evals/vally/native/canary.eval.yaml \
  --tag scenarioId=api-ts-functions-minimal \
  --model gpt-5.6-sol \
  --executor cor-aca \
  --executor-plugin ../plugins/aca-executor/index.js \
  --grader-plugin ../plugins/cor-graders/index.js \
  --runs 1 \
  --workers 1 \
  --max-retries 0 \
  --output-dir evals/results/vally-native/single-rails

# Stable paid alias for exactly the command above.
npm run eval:cor:vally:paid:single-rails
```

Vally resolves local plugin paths relative to the eval spec, which is why the direct command uses
`../plugins`. `vally experiment run` resolves its backend relative to the experiment file's
`evals/vally/native/experiments` directory, so the backend path is `../../plugins`:

Every direct run writes `executor-artifacts/reports/run-diagnostics.md` and
`run-diagnostics.json`. The failed grader line includes the same concise diagnosis: which upstream
gates passed, the primary stage/code, the exact failing task and missing executable or test input,
repair usage, and which dependent gates were not attempted. The Markdown report adds the complete
gate table, command, working directory, stdout/stderr excerpts, and recommended action.

Vally shows two top-level graders by design. `authoritative-local-hard-gates` is one hierarchical
grader over the individual planning, scaffold, build, test, integration, runtime, browser,
accessibility, persistence, debugger, cleanup, model, and provenance gates.
`authoritative-metric` is a zero-weight integrity assertion that verifies the exported
`authoritative_hard_gates_passed` metric agrees with that evidence; it is not a second project test.

```sh
# Offline plan: two scenarios × Rails/baseline, one run each.
vally experiment run \
  evals/vally/native/experiments/compatibility-pilot-gpt-5-6-sol.experiment.yaml \
  --backend ../../plugins/aca-executor/backend.js \
  --workers 1 \
  --dry-run

# PAID: primary-model alias, four trials.
npm run eval:cor:vally:paid:pilot

# PAID: four trials each; all three commands total 12 trials.
npm run eval:cor:vally:paid:pilot:gpt-5-6-sol
npm run eval:cor:vally:paid:pilot:claude-sonnet-5
npm run eval:cor:vally:paid:pilot:gpt-5-4-mini

# PAID: 16 trials per command; run all three for the representative model set.
npm run eval:cor:vally:paid:representative:gpt-5-6-sol
npm run eval:cor:vally:paid:representative:claude-sonnet-5
npm run eval:cor:vally:paid:representative:gpt-5-4-mini

# PAID RELEASE: 20 scenarios × 2 arms × 3 runs = 120 trials.
npm run eval:cor:vally:paid:release
```

`paid:pilot` is an alias for the `gpt-5.6-sol` pilot; use either name, not both, when running the
three-model set.

All paid experiment aliases use
`--backend ../../plugins/aca-executor/backend.js` and cap Vally at two workers. Vally 0.12's
`experiment run` command accepts a backend plugin but has no experiment-level
`--executor-plugin`/`--grader-plugin` options. Generated experiment plans therefore deliberately
name the mock executor, while the `cor-aca` backend delegates each resolved trial to the ACA custom
executor and invokes the authoritative custom grader in-process. This is a Vally 0.12 compatibility
bridge, not mock execution.

### Deliberate model set

Models are explicit, pinned, and never pooled:

| Model | Purpose |
|---|---|
| `gpt-5.6-sol` | Primary/default high-capability release candidate and longitudinal reference. |
| `claude-sonnet-5` | Cross-provider high-capability check that exposes provider-specific coupling. |
| `gpt-5.4-mini` | Smaller, lower-cost sensitivity check for capability and price/performance regressions. |

Nightly compatibility CI uses the primary model. Operators can run the compatibility pilot for all
three models separately (12 total trials). The representative tier also runs all three separately.
The release alias uses only the primary model so release cost and evidence stay bounded.

### Endpoint and ACA safety contract

The ordinary authoritative endpoint is `local`: generated code runs and is tested inside a
hardware-isolated ACA Sandbox microVM. `local` never means or claims Azure deployment.
Live deployment and real VS Code F5/breakpoint parity are separate, explicit, release-only evidence
tiers; neither is implied by an ordinary Vally result.

Sandbox manifests are the reproducible CI/CD path. Scaffold, validate, then apply them with the
authoritative `aca` CLI:

```sh
aca sandbox init
aca sandbox validate --file sandbox.yaml
aca sandbox apply --file sandbox.yaml
```

Edit the generated manifest's disk, resources, `lifecycle.autoSuspendPolicy`, `egressPolicy`,
ports, environment, and labels as needed; `aca sandbox schema` provides editor schema data. The
checked-in evaluator manifests use deny-default egress with an explicit host allow-list, a
one-hour auto-delete TTL, and auto-suspend. Every trial adds a unique exact `owner-id` plus
`run-id`; cleanup selects that exact `owner-id` and deletes only the returned exact sandbox IDs.
Never use `az containerapp` for this system: it is the older Apps/Jobs surface, not ACA Sandboxes.

## Deterministic validation

These commands make no model calls or Azure resource changes:

```sh
npm run eval:cor:spike:dry
npm run eval:cor:baseline -- --dry-run
npm run eval:cor:matrix -- \
  --models gpt-5.6-sol,claude-sonnet-5 \
  --scenarios api-ts-functions-minimal \
  --attempts 1 \
  --through scaffold \
  --seed compatibility-pilot-v1 \
  --output evals/results/compatibility-pilot \
  --dry-run
```

Use `npm run eval:cor:baseline -- --help` for all baseline options.

## Nightly CI end state and spend guards

`.github/workflows/copilot-on-rails-evals.yml` has four explicit tiers:

| Tier | Trigger | Work |
|---|---|---|
| `contracts` | Pull requests or dispatch | Offline generation drift check, strict lint, oracle, focused tests, threshold validation, and experiment dry-run. No model calls or Azure changes. |
| `daily` | Nightly every day or dispatch | Bounded primary-model compatibility evidence at the ordinary local endpoint. |
| `weekly` | Sunday schedule or dispatch | Separate representative experiments for the explicit three-model set. |
| `release` | Dispatch only | Fails closed before paid calls until provenance-bound VS Code parity and explicitly authorized live-deployment evidence are wired into the workflow. |

Scheduled model calls are disabled unless the repository variables
`COR_EVAL_DAILY_ENABLED=true` and/or `COR_EVAL_WEEKLY_ENABLED=true` are set. Required repository
variables are `COR_EVAL_RESOURCE_GROUP`, `COR_EVAL_SANDBOX_GROUP`, and `COR_EVAL_REGION`; configure
`COR_EVAL_AZURE_LOCATION` only for an explicitly authorized live-deployment tier. Required secrets
are `COR_EVAL_AZURE_CLIENT_ID`, `COR_EVAL_AZURE_TENANT_ID`,
`COR_EVAL_AZURE_SUBSCRIPTION_ID`, and `COR_EVAL_COPILOT_GITHUB_TOKEN`. The Azure identity needs ACA
Sandbox Group Data Owner access. A live-deployment subscription must be dedicated to evaluation.

CI caps Vally/native workers at two rather than allowing unbounded fan-out. It retains
`cor-vally-native-*` experiment evidence, an aggregated release-policy report, and separate
`cor-vally-cleanup-*` cleanup evidence for 30 days, uploading them even after trial failure. Every
sandbox receives an exact workflow/trial `owner-id`; `always()` cleanup lists by that exact label,
deletes only those IDs, lists again, and fails the job unless the post-delete result is empty. The
manifest's one-hour auto-delete policy is a fail-safe, not a substitute for verified cleanup.

Dispatch accepts only `tier` plus the separately gated parity/deployment booleans:

```sh
# Offline PR-equivalent contracts
gh workflow run copilot-on-rails-evals.yml -f tier=contracts

# Exact paid daily and weekly dispatches
gh workflow run copilot-on-rails-evals.yml -f tier=daily
gh workflow run copilot-on-rails-evals.yml -f tier=weekly

# These separate evidence requests currently fail closed before paid calls.
gh workflow run copilot-on-rails-evals.yml \
  -f tier=release \
  -f run_vscode_parity=true \
  -f run_live_deployment=true
```

The daily `23 5 * * *` cron is nightly every day and remains disabled unless
`COR_EVAL_DAILY_ENABLED=true`; the Sunday three-model schedule independently requires
`COR_EVAL_WEEKLY_ENABLED=true`. A local `npm run eval:cor:vally:paid:release` is available to
collect raw 120-trial Vally-native evidence. Apply the checked-in policy afterward with
`npm run eval:cor:vally:native:report`; add `--enforce-release` to exit non-zero unless every gate
passes. CI release dispatch deliberately stops after dry resolution and before paid calls until
the provenance-bound VS Code parity and live-deployment integrations are available.

**Cost warning:** one compatibility pilot makes 4 model evaluations (12 across all three models);
the three-model representative shape makes 48; a local raw-evidence release makes 120
(20 scenarios × 3 attempts × 2 arms), before any repair calls. VS Code
parity consumes ACA time and live deployment creates billable Azure resources. Inspect the
uploaded dry plan before authorizing an expensive run. Native experiment CI produces Vally trial
records, authoritative custom-metrics grades, Vally experiment reports, same-model pass@k/pass^k
statistics, and an aggregate checked-policy recommendation. Daily and weekly jobs publish the
recommendation without treating expected product-quality failures as report-generation failures.

## Local-runtime hard gates

Local acceptance contracts are evaluator-owned and run inside a disposable ACA sandbox. HTTP probes
may declare validated headers and a JSON-compatible body; the harness safely serializes requests and
records response status, headers, and body evidence.

A browser `persistence` contract is a distinct hard gate. The initial actions and assertions must
pass, then the harness terminates only the evaluator-launched backend/frontend process groups,
relaunches those application tasks without restarting dependency tasks such as PostgreSQL or
Azurite, waits for the declared readiness probes again, reloads the declared/current page, and runs
the explicit persistence assertions. Sandbox suspend/resume and an unchanged application process
do not count as persistence evidence. Results include old/new PIDs, restart commands, readiness
results, and post-restart browser evidence.

Queue worker scenarios can declare `storageEvents`. The harness uses Azurite's documented
development account directly to create queues, enqueue the declared JSON stimulus, and poll the
output queue for the declared JSON content. This verification does not call generated tests or
generated helper code, and failures use a separate storage-event failure code. Evaluator-owned
Python Blob archival verification is also implemented: it seeds `active-documents`, selects blobs
whose `expiresAt` metadata is in the past, verifies the same name and content in
`archived-documents`, and verifies deletion of the source blob. Process liveness alone is never
reported as worker side-effect correctness.

Evidence is bounded and sanitized: command output and response bodies are truncated, browser body
text is excerpted, and queue verification records only the declared stimulus/expectation and
observed message. These gates prove behavior in the isolated Azurite/local-service environment, not
durability or compatibility of a deployed Azure resource.

## Controlled baseline

Each scenario has two prompts: `prompt` drives the Rails treatment and `baselinePrompt` is one
standalone implementation request for the controlled baseline. A real paired run must pin the
same model explicitly in both arms:

> **Paid-call warning:** both commands below invoke the selected coding model.

```sh
MODEL=<model-id>
npm run eval:cor:scaffold -- --model "$MODEL" --scenario api-ts-functions-minimal --output evals/results/treatment
npm run eval:cor:baseline -- --model "$MODEL" --scenario api-ts-functions-minimal --output evals/results/baseline
```

The baseline uses the SDK's generic coding agent in empty mode and an empty candidate workspace.
It loads no Rails agents or references, custom agents, skills, custom instructions, webview gates,
handoffs, MCP servers, or Rails-only artifacts. Only workspace file tools are available; shell,
network, MCP, and delegation are denied. Build and local-runtime validation happen outside the
agent. Local validation derives temporary metadata from the generated `.vscode/launch.json` and
the scenario's acceptance contract rather than requiring a Rails debug plan. Sanitized repair
evidence may be returned within the scenario's shared repair budget.

This is a **controlled generic-agent baseline**, not a stock-Copilot arm. A future stock-Copilot
arm should separately measure Copilot with its normal ambient instructions, tools, and product
UX. Do not label controlled-baseline results as stock Copilot.

Baseline summaries declare `evaluationArm: "baseline-controlled"` and record requested and
observed models. Treatment summaries declare `evaluationArm: "rails"`. The baseline fails closed
if the observed model differs from the requested pin. Real treatment, baseline, and local-resume
commands all require `--model`; no scenario or ambient model fallback is accepted.

## Paired reports

```sh
npm run eval:cor:report -- \
  --input evals/results/treatment \
  --baseline evals/results/baseline \
  --vscode-parity evals/results/vscode-parity-result.json \
  --deployment evals/results/live-deployment.json \
  --output evals/results/report
```

Reports pair only exact `model + scenarioId + attempt` matches from identical evaluation endpoints
(`through` must have the same set in both arms, so `scaffold` is never compared with `local`).
Modern pairs must also have an exactly equal evaluation-definition provenance object. They reject
conflicting declared arms, different per-attempt model pins, and modern definition mismatches, and
expose each arm's endpoint, model, definition, and unmatched provenance.

For declared arms, every matched attempt must provide observed-model evidence and must have
observed exactly its requested model pin in both arms. The observed model sets must also be equal.
Reports use explicit attempt or summary `observedModels` fields; legacy Rails treatment attempts
can derive this evidence from stage `agentRun.usage.models`. Missing legacy evidence is shown as
`legacy_missing`, never as verified parity. Legacy treatment reports and reports without a
baseline remain supported.

## Versioned release thresholds

`evals/release-thresholds.v1.json` is the checked-in release policy for both durable Vally-native
experiment output and the historical summary adapter.
Validate the policy independently:

```sh
npm run eval:cor:thresholds:validate

# Aggregate one or more Vally experiment output roots.
npm run eval:cor:vally:native:report -- \
  --experiment-dir evals/results/vally-native/compatibility-pilot-gpt-5-6-sol \
  --experiment-dir evals/results/vally-native/compatibility-pilot-claude-sonnet-5 \
  --output evals/results/vally-native/compatibility-report

# Release automation fails unless every gate passes and every durable manifest
# contains post-sweep cleanup verification.
npm run eval:cor:vally:native:report -- \
  --experiment-dir evals/results/vally-native/release-gpt-5-6-sol \
  --vscode-parity evals/results/vscode-parity-result.json \
  --deployment evals/results/live-deployment.json \
  --output evals/results/vally-native/release-report \
  --enforce-release

# The historical offline adapter uses the same checked-in policy.
npm run eval:cor:vally -- \
  --input evals/results/treatment/summary.json \
  --baseline evals/results/baseline/summary.json \
  --vscode-parity evals/results/vscode-parity-result.json \
  --deployment evals/results/live-deployment.json \
  --output evals/results/vally-release

# Policy experiments must be explicit.
npm run eval:cor:vally -- \
  --input evals/results/treatment/summary.json \
  --thresholds path/to/versioned-thresholds.json \
  --output evals/results/vally-policy-experiment
```

The adapter's Vally-shaped `report.json` records the threshold schema/set and every gate's measured
value, threshold, status, and rationale;
`releaseAssessment`, `experiments`, and `groups` provide the recommendation, same-model comparison,
and Vally reliability statistics. `report.md` renders those together with per-run Rails and baseline
diagnostic tables, failed-gate evidence, and links to each durable run result. `authoritative-evidence.json`
retains the native gate aggregation behind the custom graders. `npm run eval:cor:report` remains a
low-level compatibility/debug command for historical native consumers.

`eval:cor:vally:native:report` discovers only durable `artifacts/native-summary.json` bundles from
`vally experiment run`, cross-checks summary, run-result, manifest, authoritative validation, and
metrics identities, rejects duplicate run IDs, and separates Rails from controlled-baseline inputs.
Its `experiment-input-manifest.json` records every accepted artifact directory and whether the
executor persisted post-sweep cleanup verification. `--enforce-release` requires that proof and
exits non-zero unless the recommendation is `candidate`. `vally-native-report.json` wraps the
input manifest and policy report as one machine-readable record; `report.md` includes the same
native-input integrity summary and per-run diagnostics.

Gate status is strict:

- `passed` means present evidence met the configured threshold;
- `failed` means present evidence violated it;
- `missing_evidence` means an applicable required measurement was absent or incomplete; and
- `not_applicable` means the scenario corpus declares no such contract. It is never counted as a
  pass.

Local evaluation is dependency-aware. A failed generated test or lint command keeps the attempt
failed, but Rails and controlled-baseline runs continue through integration, runtime, browser,
persistence, and debugger validation. Build, setup, infrastructure, and invalid integration
failures still stop dependent stages. Authoritative gates grade their own evidence rather than
inheriting the attempt's overall outcome, so a run can truthfully report `test: failed` and
`debugger: passed`.

Any missing gate keeps the existing `insufficient_evidence`
recommendation. With complete evidence, any failed gate recommends `hold`; only all applicable
gates passing recommends `candidate`. Vally-native daily and weekly CI publish this assessment;
release enforcement is available but the release workflow remains pre-paid blocked on the separate
debugger/deployment evidence integrations.
The policy covers zero configured critical security/destructive/cleanup failures, full corpus
coverage, three repetitions for every model+scenario, final and first-pass success, complete UI
browser/accessibility scans with zero serious/critical violations, persistence and worker
side-effect checks where declared, provenance-bound debugger and deployment evidence, verified
deployment cleanup, controlled-baseline non-inferiority, paired latency and nano-AIU cost
multipliers, and explicit arm/commit/assets/model/cleanup provenance. A zero or absent baseline
nano-AIU measurement is missing cost evidence, not a free passing multiplier.

Baseline release gates are evaluated per model. Pairing is exact on
`model + scenarioId + attempt + through`; every release model/scenario group must have the configured
number of pairs. Requested and observed model parity must be verified in both arms. Cross-model,
cross-endpoint, unmatched, pooled, or legacy-missing pairs cannot satisfy release gates.

### Evaluation-definition provenance

Every new Rails and controlled-baseline attempt records an `evaluationDefinition` object, and its
summary records the exact `evaluationDefinitions` represented by its attempts. The modern schema has
four `sha256:` hashes:

- `scenarioCorpusHash`: raw bytes and repository-relative paths for the exact selected scenario JSON
  corpus;
- `evaluatorHash`: evaluator TypeScript, ACA manifests, Vally/runtime files, release thresholds,
  workflow, and locked package/runtime definitions;
- `productContractHash`: Copilot-on-Rails agents/references, product webview/controller contracts,
  and shared agent-execution sources; and
- `combinedHash`: the versioned scenario IDs and all three component hashes.

Paths are normalized and sorted before hashing, so traversal order does not affect the result while
any covered uncommitted content change does. Matrix dry manifests retain the selected-corpus
definition. Child jobs retain their one-scenario definition; aggregation rejects missing/malformed
modern data, a scenario definition that changes between attempts, or evaluator/product hashes that
change during the matrix. Rails and baseline paired reports reject unequal modern definitions.
Debugger and deployment evidence copy the source attempt definition and must match it exactly.

Historical summaries without these fields still render and compare with explicit
`legacy_missing` provenance. They cannot satisfy `evaluation-definition-provenance` or
`cleanup-provenance`, so their release recommendation remains `insufficient_evidence`; missing
hashes are never inferred from the current checkout.

## Multi-model matrix

The matrix runner pins every model explicitly and schedules one Rails process and one controlled
baseline process for each `model + scenario + attempt` pairing. A seeded schedule randomizes pair
order and which arm runs first. Each child retains the normal evaluator summary and cleanup
behavior; the matrix writes the exact schedule to `matrix-manifest.json`, combined references to
`matrix-summary.json`, and a verified paired report under each sanitized model directory.

Compatibility pilot:

```sh
npm run eval:cor:matrix -- \
  --models gpt-5.6-sol,claude-sonnet-5 \
  --scenarios api-ts-functions-minimal,crud-react-functions-postgres \
  --attempts 1 \
  --through scaffold \
  --concurrency 2 \
  --seed compatibility-pilot-v1 \
  --output evals/results/compatibility-pilot
```

Representative scaffold matrix:

```sh
npm run eval:cor:matrix -- \
  --models gpt-5.6-sol,claude-sonnet-5,gpt-5.4-mini \
  --scenarios api-ts-functions-minimal,crud-react-functions-postgres,multiservice-react-functions-worker-postgres-queue,worker-python-functions-blob \
  --attempts 2 \
  --through scaffold \
  --concurrency 3 \
  --seed representative-matrix-v1 \
  --output evals/results/representative-matrix
```

**Cost warning:** real matrix runs make two full evaluator runs per model, scenario, and attempt.
The representative command above launches 48 paid, potentially long-running model evaluations.
Run the same command with `--dry-run` first to inspect its deterministic manifest without making
model calls. Real and dry runs both require explicit, non-empty model and scenario lists; repeated
`--models` and `--scenarios` flags are also accepted.

Legacy adapter release recommendations use only explicit VS Code parity and live-deployment result
inputs. A deployment passes the gate only when its result passed and cleanup was verified.
Live deployment also requires `--source-result <local-run>/run-result.json`; it deploys only the
archived workspace beside that result, restores local `azd` state, and verifies that the dedicated
subscription returns to its pre-run resource inventory.

## Legacy offline summary adapter

`npm run eval:cor:vally` adapts archived native summaries into Vally-shaped records and a legacy
offline release-policy report. It is distinct from the Vally-native `vally experiment run` records
and reports produced by the ACA backend. ACA build/runtime, browser, accessibility, persistence,
worker-event, VS Code debugger, and deployment validators remain its authoritative evidence
producers. Adapter report generation never executes generated code, invokes an agent/model, or
calls an LLM judge.

The adapter uses Vally's trajectory taxonomy, built-in `custom-metrics` grader, suites/oracles,
multi-trial pass@k and pass^k statistics, flakiness, and portable JSONL records. Its trajectories
contain only evidence actually retained in the summary: the evaluator stimulus, stage summaries,
tool-call summaries, errors, and aggregate token/nano-AIU events. They contain no
`assistant_message` or reasoning events, `output` is empty, and metadata explicitly declares
`source: copilot-on-rails-summary-adapter` and `transcriptFidelity: summary-only`. A stage-level
token event is an aggregate, not an individual API response.

Generate the legacy adapter report:

```sh
npm run eval:cor:vally -- \
  --input evals/results/treatment/summary.json \
  --baseline evals/results/baseline/summary.json \
  --vscode-parity evals/results/vscode-parity-result.json \
  --deployment evals/results/live-deployment.json \
  --output evals/results/vally-report
```

`--input` and `--baseline` are repeatable. Inputs must have unique run IDs, known scenarios,
declared arms, pinned/observed model provenance, and (for the controlled baseline) evidence that
Rails assets and custom tools were not injected. Treatment and baseline matching is exact on
`model + scenario + attempt + endpoint`, with exact modern evaluation-definition parity. Models,
endpoints, definitions, and arms are never pooled.

The output contains:

- `treatment/results.jsonl` and, when supplied, `baseline/results.jsonl`: Vally
  `trial-result` records with trajectories and grades;
- `*/attempts/<run-id>/custom_metrics.json`: the authoritative per-attempt metrics artifact;
- per-attempt `trajectory.json` and `grade.json`;
- `regrade-eval.yaml`: a generated, no-LLM custom-metrics spec matching the emitted stimuli;
- `report.json` and `report.md`: the legacy offline same-model comparison, per-model/scenario/arm
  pass rate, unbiased pass@k, pass^k reliability, flakiness, hard-gate-normalized score, release
  thresholds, and recommendation;
- `authoritative-evidence.json`: low-level native aggregation consumed by the legacy adapter report;
  and
- `comparison-manifest.json`: exact pairs and unmatched records.

An inapplicable gate has `*_applicable: false`, `*_status: "not-applicable"`, and a null result.
An applicable gate with no archived evidence has `*_status: "missing-evidence"` and fails. The
adapter builds per-attempt `custom-metrics` assertions dynamically, requiring final product
success plus only that scenario/endpoint's applicable browser, accessibility, persistence,
worker, debugger, or present deployment gates. Explicit `--vscode-parity` and `--deployment`
artifacts are matched back to their exact source run and incorporated into that attempt's custom
metrics as well as aggregate release gates. `gradeTrajectory` runs the built-in grader.
Because its fractional assertion score is not a safe release score, any failed hard gate
normalizes the reported aggregate to zero.

The JSONL retains each trajectory's strict per-attempt artifact directory. While the output
remains at that location, it can be deterministically re-graded without model calls:

```sh
vally grade \
  --eval-spec evals/results/vally-report/regrade-eval.yaml \
  --output jsonl \
  < evals/results/vally-report/treatment/results.jsonl
```

Validate the checked-in Vally-native contract without model calls:

```sh
npm run eval:cor:vally:native:check
npm run eval:cor:vally:native:lint
npm run eval:cor:vally:native:oracle
npm run eval:cor:vally:native:test
```

The pinned `@microsoft/vally@0.12.0` and `@microsoft/vally-cli@0.12.0` public APIs used here are
`Trajectory`, `gradeTrajectory`, `computeMetrics`, `computeStimulusScore`, `computeSkillScore`,
`passAtK`, and `passToTheK`. Both packages declare Node.js `>=22.0.0` and npm `>=11.11.1`;
use those versions for supported local and CI execution.

### Supplemental qualitative comparison

`vally compare` uses a qualitative judge and position-swap debiasing. It is supplemental, costs
model calls, and is never run by the adapter. **Do not run it on these summary-only records**:
they omit assistant responses and reasoning, so they are invalid qualitative evidence. If a
future archive contains faithful full transcripts for both exactly matched arms, use a matching
rubric-bearing eval spec and pin the judge:

```sh
vally compare \
  --baseline <full-transcript-baseline-results.jsonl> \
  --treatment <full-transcript-treatment-results.jsonl> \
  --eval-spec <matching-qualitative-eval.yaml> \
  --judge-model gpt-5.6-sol \
  --judge-reasoning-effort medium \
  --output <qualitative-comparison.jsonl>
```
