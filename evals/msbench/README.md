# Running the agent evals on MSBench

The Vally suite in `evals/` runs the `azure-project-plan` agent headlessly through the
Copilot SDK. This folder runs the *same contracts* against the **real extension** in
**real VS Code** on [MSBench](https://aka.ms/msbench), via the `vscode` special agent.

The two are complementary, not redundant:

| | `evals/` (Vally) | `evals/msbench/` |
| --- | --- | --- |
| Runs | Copilot SDK, headless | Real VS Code + our VSIX |
| Tools | `evals/mcp/workflow-tools.ts` stand-in | The extension's in-process MCP server |
| Webviews | Never opened | Actually rendered |
| Where | GitHub Actions, ~30 min | MSBench CES, with video + screenshots |
| Role | Fast PR gate | Nightly, pass@k, model sweeps |

The four **single-turn** stimuli from [`evals/project-plan/eval.yaml`](../project-plan/eval.yaml)
are ported here, one config per stimulus in [`config/stimuli/`](config/stimuli).
`evals/project-plan/eval.yaml` stays the source of truth; this folder is a port of it,
so changes there need mirroring here until the remaining three (multi-turn) stimuli are
wired up.

| Stimulus | Assertions | Validator flags |
| --- | --- | --- |
| `photo-app-requirements` (default) | 7 | — |
| `api-only-inventory` | 5 | `--assert-no-frontend --assert-blob-storage --assert-cosmosdb` |
| `multi-service-order-processing` | 4 | `--assert-service-count=3` |
| `no-datastore-converter` | 4 | `--assert-no-datastore` |

Assertion counts differ because they mirror each stimulus's graders one-for-one rather
than being levelled up — only `photo-app-requirements` specifies
`no-dotfile-requirements` and `transcript-not-contains`, and only it and
`api-only-inventory` specify `no-premature-plan`.

All four are verified by a real green run; ids are under
[Verified result](#verified-result).

## Quick start

```bash
az login          # once
./run.sh          # builds the VSIX, installs tooling, submits the run
```

Re-run without rebuilding the extension using `./run.sh --skip-build`, and pick a
different stimulus with `./run.sh --stimulus api-only-inventory`. With no arguments it
runs `photo-app-requirements`, exactly as before.

Wall-clock varies a lot with CES queueing: the original runs took ~4 min of MSBench
time, but a run on 2026-08-25 took 50 min for the same single instance. Budget
accordingly rather than assuming a stall.

`run.sh` is self-contained: it provisions a Python 3.10+ virtualenv, installs
`msbench-cli` plus the `vscode` special agent from the internal feed, stages the VSIX
and the graders, builds the config, and submits. The only prerequisites are Azure CLI
and Node.

### Access

You need the **`MSBench User`** role, requested at <https://aka.ms/msbench/access>
(manager approval; syncs within the hour). That is the *only* access prerequisite —
it grants the artifact feed, ACR, and Kusto in one go. Nothing else needs
provisioning, and no other team needs to be involved.

`run.sh` mints the feed token with `az account get-access-token` rather than using
`keyring`, which otherwise drops into an interactive prompt and hangs.

## Verified result

**All 7 assertions passed, `resolved: true`, on every `photo-app-requirements` run
below** (links need Corpnet/Azure VPN):

| Run | Base branch | Notes |
| --- | --- | --- |
| [`2026082467524759`](https://msbenchapp.azurewebsites.net/run-analysis/2026082467524759) | Copilot-on-Rails | first green run |
| [`2026082468156047`](https://msbenchapp.azurewebsites.net/run-analysis/2026082468156047) | Copilot-on-Rails | from a clean venv |
| [`2026082471095778`](https://msbenchapp.azurewebsites.net/run-analysis/2026082471095778) | Copilot-on-Rails | CI-style flags |
| [`2026082478636953`](https://msbenchapp.azurewebsites.net/run-analysis/2026082478636953) | Copilot-on-Rails | control |
| [`2026082479418416`](https://msbenchapp.azurewebsites.net/run-analysis/2026082479418416) | `feat/CoR` | #1689's base |
| [`2026082509500207`](https://msbenchapp.azurewebsites.net/run-analysis/2026082509500207) | `meganmott/happy-hedgehog` | while stacked on #1683, before it merged |
| [`2026082579322454`](https://msbenchapp.azurewebsites.net/run-analysis/2026082579322454) | `feat/CoR` | **first run with the real validator as `exec:`** |

The agent produced a 236-line `.azure/requirements.json` and called the extension's real
`open_requirements_view` tool (as `mcp_copilot_azure_open_requirements_view`).

In `2026082579322454` the `exec` table confirms the grader genuinely ran in-container
rather than being skipped — fingerprint `Linux x86_64 / cwd=/workspace / node=v22.22.2`,
and the validator's own `PASS: requirements.json satisfies the requirements contract` on
stderr.

The other three stimuli are each verified by their own green run, with the validator
genuinely executing under the flags that distinguish them:

| Stimulus | Run | Result |
| --- | --- | --- |
| `api-only-inventory` | [`2026082582848923`](https://msbenchapp.azurewebsites.net/run-analysis/2026082582848923) | 5/5 |
| `no-datastore-converter` | [`2026082585315961`](https://msbenchapp.azurewebsites.net/run-analysis/2026082585315961) | 4/4 |
| `multi-service-order-processing` | [`2026082586199078`](https://msbenchapp.azurewebsites.net/run-analysis/2026082586199078) | 4/4 |

### The negative control, in MSBench

The validator's failure path was already verified locally, but that only proves the
*grader* exits non-zero — not that MSBench notices. An assertion that cannot go red is
worse than no assertion, so
[`2026082582510393`](https://msbenchapp.azurewebsites.net/run-analysis/2026082582510393)
ran the photo-app prompt (which asks for PostgreSQL) against the validator invoked with
`--assert-no-datastore`, a contract it must fail.

Result: **6/7, with only the `exec:` assertion red** and `resolved: false`. The failure
was attributable rather than merely present — exit code **1**, a product failure rather
than the exit 3 that means the grader itself broke:

```
FAIL: requirements.json satisfies the requirements contract
  — Expected "No datastore required" in recommendedChoice, got: Blob Storage, PostgreSQL
```

So the assertion fails for the intended reason, and the failure stays isolated to the
one assertion under test instead of collapsing the whole run.

## How it works

`vscbench.say_hello` is borrowed purely for its container image. The
`assets/user-overrides.yaml` is staged as the **last** of three config layers
(base → benchmark instance → user overrides, see `scripts/run-agent.sh` in
`microsoft/vscode-copilot-evaluation`). Merging is a shallow `Object.assign`, so our
`promptSteps` wholly replace `say_hello`'s.

That is the trick that keeps this cheap: **no new benchmark instance, no Docker image
to publish, and no PR into the eval repo.** `installExtensions` is the one key that
concatenates rather than replaces, so our VSIX installs alongside `github.copilot-chat`.

The agent definition is unpacked from the VSIX itself rather than cloned from GitHub,
so the instructions always match the build under test. Cloning a branch would let the
two drift and silently grade the wrong version of the prompt.

## Layout

Three things under `assets/` are **generated on every run and gitignored**, because a
second checked-in copy is exactly the drift this eval exists to catch:

| Path | Built by | From |
| --- | --- | --- |
| `assets/extensions/*.vsix` | `run.sh` | `npm run build && npm run package` |
| `assets/graders/**` | `stage-graders.ts` | `evals/graders`, `evals/src`, `src/webviews` |
| `assets/user-overrides.yaml` | `build-config.ts` | `config/base.yaml` + `config/stimuli/<name>.yaml` |

Edit `config/`, never `assets/`.

Both generators are TypeScript run directly by Node, which strips the types at load
time — there is no build step and no emitted JavaScript. `evals/tsconfig.json`
type-checks them (`npm run typecheck`) but emits nothing.

### Why one config file per stimulus

Not a preference — two independent constraints force it:

1. `run-agent.sh` does a literal `cp "$PWD/user-overrides.yaml"`, so that filename is
   the only config the agent will ever read. A stimulus cannot be chosen with a flag;
   selecting one means *writing that file*, which is what `build-config.ts` does.
2. `promptSteps` feeds a **single chat session**. Stacking the four stimuli as four
   steps would let a later one see the `requirements.json` an earlier one wrote, and
   `no-premature-plan` would fail spuriously.

So the only real choice was whether the shared preamble (VSIX path, `chatMode`, the
agent-seeding `script:`) is copied into four files or written once. It is written once,
in `config/base.yaml`, and concatenated with a stimulus file. The merge is textual
rather than a YAML round-trip so that the explanatory comments survive into the
generated file — the two sources define disjoint top-level keys, and `build-config.ts`
fails if that ever stops being true.

## Running the real validators (`exec:`)

Megan's `program` graders run as `exec:` assertions, so the contract is checked by the
*same* validator code the Vally suite and grader certification use, rather than a SQL
lookalike that would drift from it.

`exec:` runs after the agent finishes, via `shell: true`, with **cwd set to the
workspace** — so `graderHarness`'s `process.cwd()` fallback already resolves
`.azure/requirements.json` correctly. Do **not** pass `EVALUATE_WORKSPACE=/workspace`:
the runner uses a worktree path instead of `/workspace` on some routes, so hardcoding it
would be wrong where cwd is always right.

Results land in an `exec` table (`command`, `exitCode`, `stdOut`, `stdErr`), and with
the default `assertZeroExitCode` the harness generates
`SELECT COUNT(*) > 0 FROM exec WHERE exitCode = 0 AND command = :command`.

`stage-graders.ts` copies the graders in, preserving repo-relative paths so their
relative imports resolve unchanged — the closure spans **two roots**, `evals/` and the
extension's own `src/webviews/`. It walks the import graph from the three validators
rather than hardcoding a file list, which catches two things locally in milliseconds
instead of four minutes into a container run: a moved file, and a *bare* specifier
reachable from a grader (e.g. `vscode-nls`), which would need a `node_modules` the
container does not have.

Verified in the container: **Node v22.22.2 on Linux x86_64**, which is past the 22.18
cutoff where TypeScript type-stripping is on by default — so the graders run straight
off source, with `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` and a
`{"type":"module"}` package.json at the staged root.

### One fidelity gap worth knowing

`graderHarness` distinguishes exit 1 (bad artifact, a real product failure) from exit 3
(the grader itself broke). MSBench collapses both into "non-zero", so a harness fault is
reported as a product regression here. That is the conservative direction — a broken
grader shows up as red rather than silently passing — but it means a red `exec:`
assertion is worth confirming against `stdErr` before believing it.

### Which assertions are `exec:` and which stay SQL

Only the `program` graders. The `files`, `toolCalls` and `llm_responses` tables cover
`file-exists`, `file-not-exists`, `tool-calls` and `transcript-not-contains` honestly in
one line each, and SQLite's JSON functions can inspect artifact content directly. What
SQL *cannot* do without reimplementing the validator in a second language is the
semantic part — schema version, per-question shape, service roles and counts, datastore
recommendations. Those are the ones that become `exec:`; the rest stay SQL rather than
being converted for the sake of it.

Concretely, the check this replaced was
`json_valid(content) AND json_array_length(json_extract(content, '$.questions')) > 0`.
Given `{"projectName":"x","questions":[{"id":"dataStores","label":"nope"}]}` that returns
**pass**, while the real validator returns **fail** naming seven contract violations
(wrong `schemaVersion`, no `services`, and five missing per-question fields).

Each stimulus also carries a deliberately non-asserting `exec:` with
`assertZeroExitCode: false`. It records an environment fingerprint into the `exec` table
without generating a check, so it can never fail a run or change the assertion count.
Read it first when a grader goes red — "no Node", "Node too old", and "tree staged to
the wrong path" are indistinguishable from the outside:

```bash
sqlite3 session.sqlite "SELECT output FROM exec WHERE command LIKE '%uname%'"
sqlite3 session.sqlite "SELECT exitCode, stdErr FROM exec WHERE command LIKE '%validate-%'"
```

### What the fingerprint reports, and why

It answers a question the suite is about to depend on. We are expanding to many project
stacks (React + Functions + Postgres, Python + FastAPI + Cosmos, C# + Functions + SQL,
static sites, workers) and adding gates that actually **build and run** the generated
project. All of that executes inside the borrowed `say_hello` image — an image nobody
here chose the contents of. The stacks we can test are bounded by what it already has,
so the probe reports one `name=value` per line:

| Group | Probed |
| --- | --- |
| Staged assets | the graders tree at `/agent/assets/graders/evals/graders`, and the VSIX's byte size |
| Language runtimes | `node`, `npm`, `npx`, `python3`, `pip`, `pip3`, `dotnet`, `java`, `go` |
| Database clients | `psql`, `sqlcmd`, `mongosh`, `redis-cli` |
| Cloud and containers | `az`, `azd`, `func`, `docker` |
| Build essentials | `git`, `make`, `gcc`, `unzip`, `curl` |
| Capacity | free disk, total memory, CPU count |
| Egress | HTTP status against the npm, PyPI and NuGet endpoints, plus `HTTPS_PROXY` |

The first row is the triage row, and it is why this predates the breadth question:
`stage-graders.ts` copies the grader sources in at run time preserving repo-relative
paths, so a tree staged to an unexpected path fails every `exec:` grader in a way that
looks exactly like a product regression. A missing or truncated VSIX is the same kind of
invisible failure — `run.sh` guards it locally, but not a staging failure in between, so
the byte count is recorded (~7 MB is healthy, ~1 MB is a VSIX built without `npm run
build`).

Egress is the critical one, because it decides which of three answers we get:
present (breadth is free), absent but installable in the `script:` preamble (breadth
costs setup minutes per run, and only works if the container can reach the internet), or
neither (breadth needs our own published image, forfeiting the cheapness of borrowing
one). `net_*=200` means reachable; `net_*=000` means the request never completed.

Read `net_*` narrowly: it proves the endpoint answered, not that `npm install` works. An
intercepting proxy returns 200 too, and so does a registry that then refuses the actual
package fetch. It is conclusive in the negative direction — a `000` means outcome (b) is
off the table — and only suggestive in the positive one.

Every probe is individually failure-tolerant — a missing binary prints `MISSING` and the
script continues, so one absent tool cannot truncate the answer.

The probe is **defined once**, in `config/base.yaml`'s `script:` preamble, which writes
it to `/tmp/env-fingerprint.sh`; each stimulus's `exec:` entry just runs that file. It
cannot live in `base.yaml` as an assertion, because assertions nest under `promptSteps`,
which `build-config.ts` requires the stimulus file to define and refuses to let
`base.yaml` duplicate. The preamble also *runs* it, so the same output lands in
`customScript/output.log` — belt and braces if `/tmp` turns out not to be shared with
the `exec` phase, which is also why the `exec:` entry falls back to a bare `uname`
rather than printing nothing.


## Why the VSIX route

`contributes.mcpServerDefinitionProviders` registers an in-process MCP server
(`src/chat/tools/copilotOnRails/registerCopilotOnRailsTools.ts`) exposing
`open_requirements_view`, `open_plan_view`, `start_project_scaffold` and the rest.
Those are the exact names the Vally `tool-calls` graders assert on, so the assertions
port across unchanged — but here they are satisfied by the shipping code path rather
than a test double.

## Assertion mapping

| Vally grader | vscbench assertion |
| --- | --- |
| `file-exists` | `SELECT COUNT(*) > 0 FROM files WHERE path LIKE …` |
| `file-not-exists` | `SELECT COUNT(*) = 0 FROM files WHERE path LIKE …` |
| `tool-calls` (`required`) | `SELECT COUNT(*) > 0 FROM toolCalls WHERE tool LIKE …` |
| `constraints.reject_tools` | `SELECT COUNT(*) = 0 FROM toolCalls WHERE tool LIKE …` |
| `transcript-not-contains` | `SELECT COUNT(*) = 0 FROM llm_responses WHERE response LIKE …` |
| `program` | `exec:` (defaults to asserting exit code 0) |

Every table carries a `stepIndex`, and `AND stepIndex = :stepIndex` is appended
automatically so an assertion only sees its own turn — which is what will make the
multi-turn stimuli straightforward. `llm_responses.response` is user-facing prose
only, excluding tool output and thinking blocks, so substring assertions don't
false-match text the agent merely read.

There is also a third assertion type with no Vally equivalent: **LLM-as-judge**. A judge
model reads whatever rows `promptInputQuery` selects and returns pass/fail.

```yaml
- comment: The plan justifies its datastore choice
  promptInputQuery: SELECT path || ':' || char(10) || content FROM files WHERE path LIKE '%project-plan.md'
  prompt: "Evaluate whether the plan explains *why* each datastore was chosen. ${queryResult} Respond PASS if it does, FAIL otherwise."
  mode: pass_fail
```

Nothing here uses it yet. It is the right tool for the qualitative parts of a plan —
whether reasoning is coherent, whether prose matches the chosen services — and a better
answer than inventing a brittle SQL proxy for a judgement call. It is not a substitute
for `exec:` on anything the validators already decide deterministically.


## Results and artifacts

```bash
msbench-cli report  --run_id <id>
msbench-cli extract --run_id <id> --output ./out
```

Assertion detail is in `eval.json`. Also captured: `screen_recording.mp4`,
`patch.diff`, `session.sqlite` (queryable with the same SQL as the assertions),
`extension-host.log`, and `customScript/output.log`. See
[AGENT_OUTPUTS.md](https://github.com/microsoft/vscode-copilot-evaluation/blob/main/doc/references/AGENT_OUTPUTS.md).

## Running in CI

[`.github/workflows/msbench-evals.yml`](../../.github/workflows/msbench-evals.yml) runs
this on `ubuntu-latest`. It is **`workflow_dispatch` only**, because it cannot run yet
without one-time setup.

The Vally CI path needed no secrets — `copilot-requests: write` lets the built-in
`GITHUB_TOKEN` authenticate the Copilot CLI. That trick does not transfer. MSBench runs
on CES, which identifies callers by Entra client id, so CI needs a real Azure identity:

1. Create a user-assigned managed identity (or app registration) and add a federated
   credential for this repo.
2. Set `MSBENCH_AZURE_CLIENT_ID`, `MSBENCH_AZURE_TENANT_ID` and
   `MSBENCH_AZURE_SUBSCRIPTION_ID` as repository secrets.
3. **Ask the MSBench team to allowlist that client id for CES submission** — see
   [Submitting MSBench runs from GitHub Actions](https://dev.azure.com/devdiv/OnlineServices/_git/msbench?path=/wiki/Submitting-MSBench-runs-from-GitHub-Actions.md).
   This step is not self-service.

Step 3 is the reason the workflow is manual-only and unscheduled: until the identity is
allowlisted a scheduled run would only ever be red. Local runs need none of this —
`az login` plus the `MSBench User` role is enough, which is why that path landed first.

## Troubleshooting

Failure modes that cost real time while building this. Most now fail fast in `run.sh`
with a clear message:

- **A red run that is actually rate limiting.** Back-to-back runs get throttled by the
  Copilot API mid-run. The agent then produces nothing, so artifact assertions fail
  while negative assertions pass trivially — indistinguishable from a genuine agent
  regression at a glance. `run.sh` now detects this and **exits 75 (`EX_TEMPFAIL`) with
  a loud banner instead of letting you read the results table**, so a throttled run
  cannot be mistaken for a regression.

  The check keys on `output/error.json` → `"type": "RATE_LIMIT"` and is deliberately
  narrow: verified against three stored runs, it catches the throttled one, passes the
  green one, and — the case that actually matters — still reports the genuinely-red
  negative control as a real failure. A detector for false reds is worthless if it
  also hides true ones. Corroborate manually with
  `select name, count(*) from spans group by name` against
  `output/vsc-output/agent-traces.db` (note: `spans`/`span_attributes`, not `toolCalls`,
  which is the assertion-time view) — ~13 chat spans is healthy, dying around 6 is
  throttling. A **completely empty `exec` table** is another tell: the graders never ran
  at all, rather than running and failing.

  Observed budget: **three runs inside 14 minutes succeeded and the fourth was
  throttled**, at ~250k tokens each. So this is a rolling token allowance rather than a
  minimum gap between runs; spacing runs ~15 minutes apart is the practical rule.

- **Two `run.sh` invocations at once submit each other's stimulus.** `assets/` is shared
  mutable state — every invocation rewrites `user-overrides.yaml` before uploading it —
  so overlapping runs race and the loser submits the winner's prompt. That yields a run
  which looks entirely normal while grading the wrong stimulus, the worst failure mode
  here: it is confidently wrong rather than obviously broken. (This is exactly how run
  `2026082584891952`, invoked with `--stimulus no-datastore-converter`, graded the
  photo-app prompt.) `run.sh` now takes a lock (`assets/.run.lock`) and refuses to start
  rather than racing, and echoes the prompt it is actually submitting so a mismatch
  shows up in the log instead of only after unzipping the results.
- **`HTTP 400 BadRequest` from `/api/ces/benchmark/startRun` at submit time.** Seen
  submitting ~90s after a previous run finished; no run id is allocated. The same
  config submitted cleanly after a cooldown, so treat it as transient submission
  throttling rather than a config error — wait a few minutes and resubmit before
  debugging the YAML.
- **`msbench-cli` silently installs an ancient version.** pip's 15s default read
  timeout treats a slow feed download as an *unusable candidate* rather than a network
  error, so it backtracks through older releases and reports success — once landing
  0.3.17.post1 instead of 0.3.54. `run.sh` pins `--timeout 180 --retries 10` and floors
  the versions with `>=` so pip fails loudly instead. Check with `msbench-cli --version`.
- **`Special agent plugin 'msbench-agent-vscode' is not installed`** — plugins are
  discovered as console scripts on `PATH`, so invoking `venv/bin/msbench-cli` by
  absolute path reports every plugin as missing even when installed. `run.sh` puts the
  venv on `PATH`. Confirm with `msbench-cli list_special_agents`.
- **Every assertion fails and the extension host won't activate** — `npm run package`
  is only `vsce package`, and there is no `vscode:prepublish` hook, so the VSIX ships
  without `dist/extension.bundle.js` unless `npm run build` ran first. A good VSIX is
  ~7 MB; a broken one is ~1 MB.
- **`VSIX has no resources/agents/`** when the VSIX is fine — `unzip -l | grep -q`
  under `set -o pipefail` reports SIGPIPE (141) as failure.

## Next steps

- The three multi-turn stimuli, using `promptSteps` (native multi-turn). The per-table
  `stepIndex` scoping already does the hard part.
- LLM-as-judge assertions for the qualitative parts of a generated plan.
- Nightly CI once the CES identity is allowlisted; keep
  [`agent-contracts.yml`](../../.github/workflows/agent-contracts.yml) as the fast PR
  gate.
- Expand gates and graders, including browser assertions for the preview canvas.


Longer term these could graduate into `benchmarks/azure/` in
`vscode-copilot-evaluation`, alongside the GitHub Copilot for Azure team's deployment
scenarios (owner `fanyang-mono`). That buys a dedicated image and a richer starting
workspace, at the cost of a publish step — worth it once the set of stimuli is stable.
