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
| `photo-app-requirements` (default) | 8 | — |
| `api-only-inventory` | 6 | `--assert-no-frontend --assert-blob-storage --assert-cosmosdb` |
| `multi-service-order-processing` | 5 | `--assert-service-count=3` |
| `no-datastore-converter` | 5 | `--assert-no-datastore` |

Assertion counts differ because they mirror each stimulus's graders one-for-one rather
than being levelled up — only `photo-app-requirements` specifies
`no-dotfile-requirements` and `transcript-not-contains`, and only it and
`api-only-inventory` specify `no-premature-plan`.

The one assertion every stimulus carries that `eval.yaml` does not specify is the
**liveness sentinel**, `SELECT COUNT(*) > 0 FROM llm_responses`, which must be first.
It exists because a negative assertion (`COUNT(*) = 0`) is trivially true against an
empty table: a run that dies before the session database is populated would otherwise
collect full marks on every negative check rather than failing. It is a property of
*this* harness, not of the source spec, which is why it is not mirrored from there.

All four are verified by a real green run; ids are under
[Verified result](#verified-result). Those runs predate the sentinel, so they report
one assertion fewer than the table above.

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

**Changing a grader does not need a run at all.** Re-grade a past one instead — same
graders, stored data, zero tokens, well under a second:
[Re-grading a past run for free](#re-grading-a-past-run-for-free).

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

## Timeouts

Two unrelated things are both called a timeout here, and conflating them is expensive.

**`timeouts:` in [`config/base.yaml`](config/base.yaml) — the real ones.** Enforced by
the agent and the platform runner. The schema's defaults are sized for a single-turn
run, so they are set explicitly:

| Key | Default | Ours | Why |
| --- | --- | --- | --- |
| `agentSeconds` | 6300 (1h45m) | 18000 (5h) | The E2E chain is describe → requirements → plan → scaffold → build → run → debug in **one** session. The default is a per-turn budget, not a chain budget. Sized to fit inside the job cap — see below. |
| `stallSeconds` | 2700 (45m) | 5400 (90m) | See below. |
| `runnerGraceSeconds` | 300 (5m) | 900 (15m) | A long session has far more to flush at the end (screen recording, trajectory, `session.sqlite`) than a 5-step run, and a truncated artifact is an unreadable result. |

`stallSeconds` is the one that bites. It is **not** an agent-inactivity timeout — the
schema defines it as time with *"no agent trace, CAPI proxy log, Copilot Chat log, or
workspace file activity"*, so it fires only when all four signals are quiet at once. A
long `npm install`, `azd provision`, build or test suite produces none of the four for
minutes at a time. A healthy run doing exactly what we asked can therefore be killed for
looking idle, and it reports as a product failure. Quiet is not the same as stuck.

**These three are one budget, not three independent knobs, and the budget has to fit
inside the platform job limit.** The job clock starts before the agent clock — container
pull, VS Code and VSIX install, workspace setup and the `script:` preamble all happen
before the agent's first turn. So if `agentSeconds` is set to the full job cap, the job
is killed *first*, the agent timeout never fires, and because `runnerGraceSeconds` is
time the runner takes **after** the agent timeout, the grace period never runs either.
Nothing gets flushed — no screen recording, no trajectory, no `session.sqlite` — on
precisely the runs you most need to diagnose. `agentSeconds` must therefore be the job
cap minus setup minus grace, with margin:

```
6h job cap − ~15m setup − 15m grace ⇒ 5h agent
```

The schema gives all three a `maximum` of `9007199254740991`, so nothing above is
schema-constrained. The real ceiling is the platform job limit. GitHub documents a 6-hour
cap for hosted runners and 5 days for self-hosted; our runs report `dispatched to GitHub
Actions` with `run_platform='linux_container'`, but **we could not verify which pool
MSBench dispatches to** — that is decided by a server-side workflow not visible from the
CLI or from `vscode-copilot-evaluation`. The 6h figure above is therefore an assumption,
chosen because it is the safer of the two documented limits. If the cap is ever
confirmed, re-derive `agentSeconds` from the arithmetic above rather than just raising
it; raising it past 6h needs confirmation from the MSBench team
(<CodeExService@microsoft.com>).

**`msbench-cli run --timeout` — not the same thing, and don't add it.** It is a *local*
wait. From `cli/arguments.py`: *"Max seconds to wait locally for completion. When
reached, the CLI attempts to cancel the CES run, downloads partial results, and exits
with a timeout error."* `_handle_timeout` in `execution/ces_client.py` confirms it —
partial download, then `cancel_run`. So setting it does not give a run more time; it
**ends a still-healthy run early** and leaves you with partial artifacts. It defaults to
`None` (wait indefinitely), and `run.sh` deliberately does not pass it. Leave it that
way.

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
time — there is no build step and no emitted JavaScript. The same is true of
[`verify-run.ts`](verify-run.ts), which `run.sh` calls after a run to decide whether the
results are readable at all. `evals/tsconfig.json` type-checks them
(`npm run typecheck`) but emits nothing.

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

When iterating on one of these, use [`regrade.ts`](#re-grading-a-past-run-for-free)
rather than submitting a run: it re-runs the edited grader against a stored run's
rehydrated workspace for zero tokens, and tells you whether the verdict moved.

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

[`regrade.ts`](#re-grading-a-past-run-for-free) recovers the distinction offline: it
re-runs the grader locally and reports exit 1 and exit 3 separately, so confirming a red
`exec:` no longer means reading `stdErr` by hand.

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


## Is this run a result?

A finished run is not automatically a *result*. Two things can make the results table
mean something other than what it looks like, and neither is visible in the table:

1. **The agent was throttled mid-run.** It then produced nothing, so artifact assertions
   fail while negative assertions pass trivially — which reads exactly like a product
   regression.
2. **The model that answered was not the model requested.** Every number is then
   attributed to the wrong model.

`run.sh` runs [`verify-run.ts`](verify-run.ts) on the extracted artifacts before you can
read the table, and it owns the verdict:

| Exit | Meaning |
| --- | --- |
| `0` | The run is a result. Read the table. |
| `75` | `EX_TEMPFAIL` — throttled. Not a result at all; retry in ~15 minutes. |
| `65` | `EX_DATAERR` — the run measured something other than what was requested. |

Both are deliberately distinct from `1`, which still means a genuine red run. **A
detector for false reds is worthless if it also hides true ones**, so this is verified
against stored runs: it catches the throttled run, passes the six green ones, and still
reports the genuinely-red negative control (`2026082582510393`) as a real failure.

### Which surface got throttled

`output/vsc-output/capi-proxy.log` records every upstream model call with its path and
status. Verbatim from throttled run `2026082583236973` (interleaved header/body lines
removed, but the call lines are exactly as they appear — this is the format
`verify-run.ts` parses):

```
[2026-08-25T23:11:12.786Z] [CAPI PROXY] [8] POST /v1/messages -> 200
[2026-08-25T23:11:14.772Z] [CAPI PROXY] [9] POST /v1/messages -> 429     <-- throttled
[2026-08-25T23:11:14.773Z] [CAPI PROXY] [9] Response body:
too many requests
[2026-08-25T23:11:15.438Z] [CAPI PROXY] [10] POST /chat/completions -> 200  <-- 666ms later, SUCCEEDS
```

That 666 ms is the whole point: **the 429 is scoped to the API surface, not to the
account.** `/v1/messages` is the Anthropic surface (Claude models); `/chat/completions`
and `/responses` are OpenAI ones. They throttle independently, so being refused on one
says nothing about the others.

So the banner reports *which* surface ran out and after how many calls — "throttled on
`POST /v1/messages` after 8 successful upstream calls (2 of them on that surface)" —
which is what a per-surface token budget can actually act on.

`verify-run.ts` also prints a path census on **every** run, throttled or not, so each run
is a free datapoint:

```
    upstream model calls (capi-proxy.log):
      GET /models                  1x 200
      POST /chat/completions       9x 200
      POST /embeddings             2x 200
      POST /v1/messages            5x 200
```

The mix is model-dependent — Claude runs use both `/v1/messages` and `/chat/completions`
(auxiliary models and embeddings go to the latter), while GPT runs touch `/v1/messages`
zero times. Paths are parsed from the log rather than matched against a known list,
because the set grows as new models ship — `/responses` arrived with `gpt-5.6-sol` and
`gpt-5-mini` — and a hardcoded list would silently miss a 429 on a surface added later.

Note the asymmetry: `error.json` → `"type": "RATE_LIMIT"` is the sole authority on
whether a run is **void**. A 429 in the proxy log only means one request was refused; the
agent often retries and finishes fine, and voiding those runs would start hiding real
failures. Such a run is reported as a note and still counts:

```
    NOTE: POST /responses returned 429 after 2 successful calls,
          but the run completed. Results stand; budget is running low.
```

### Did we measure the model we asked for?

`run.sh` selects the model via `modelSelector` in the staged `user-overrides.yaml` (with
`--model .`). The check here is small, because the harness already covers the dangerous
case: `selectActiveModel` in `vscode-copilot-evaluation`'s `src/proxy/capiProxyServer.ts`
looks the requested id up in the **live `GET /models` catalogue** and throws
`X_MODEL_NOT_FOUND_ERROR` if it is absent, then pins `is_chat_fallback` and
`model_picker_enabled` on the matched entry so VS Code cannot substitute anything else.
An unknown id therefore hard-fails at launch, before any agent turn — verified with
`gpt-5` and `gpt-5.6`, at ~0 tokens each. **There is no silent fallback to a default.**

Existence is not identity, though, so `verify-run.ts` asserts that the model which became
active is the model requested, by reading the `Set active model to: <id>` line from
`output/vsc-output/agent-output.log` (mirrored in `entry.log`; present in all seven stored
runs — it is *not* in `capi-proxy.log`). One line, on artifacts already being read. It
exists to catch a future regression in model selection during model sweeps, where every
run is supposed to be a different model and a mislabelled one would collapse N models
into N runs of the same one.

**Only a dated release suffix is tolerated** between the two ids — `gpt-4o-mini` matches
`gpt-4o-mini-2024-07-18`, and nothing else matches. In particular these must *not* match,
because they are different models with different cost and capability:

| Requested | Active | |
| --- | --- | --- |
| `gpt-5` | `gpt-5-mini` | reject |
| `gpt-4o` | `gpt-4o-mini` | reject |
| `claude-opus-4` | `claude-opus-4-1` | reject |
| `gpt-5.6` | `gpt-5.6-sol` | reject |

A bare numeric revision (`claude-opus-4` → `claude-opus-4-1`) is deliberately rejected
too: Opus 4.1 is a different model from Opus 4, so absorbing that into a lenient match
would silently mislabel a sweep datapoint. The full boundary is executable —
`npm run msbench:self-test` in `evals/` asserts every accepted and rejected pair.

There is a third outcome besides match and mismatch. If the `Set active model to:` line is
missing entirely, the check **fails open and says so loudly**:

```
      !! IDENTITY NOT VERIFIED — this is NOT a pass.
      !! no "Set active model to:" line in agent-output.log or entry.log
      !! The run stands, but nothing confirmed which model answered.
```

`identity not verified` is a distinct state from `identity verified OK`, and the summary
line reflects it. Fail-open is the deliberate choice: a run that died before model
selection legitimately has no such line, and failing closed would turn every missing
artifact into a fake mismatch — and if a future harness version stopped emitting the line,
it would block every run on a false accusation. That is the same disease as a detector
that hides true reds, just pointed the other way. The cost is that the check could quietly
rot, which is exactly why the state is shouted rather than tucked into a note.

Three other values look like they would answer this and do not — they are all echoes of
the request rather than observations of the answer:

| Source | Why it can't disagree |
| --- | --- |
| `msbench-cli show_run`, `metadata.json` | `_read_assets_model_selector` (plugin `cli.py`) reads it straight back out of the `user-overrides.yaml` *we* supplied. |
| `configs/final-agent-config.json` | The same request one layer in. Proves our asset arrived intact; still not the answer. |
| `configs/msbench-user-overrides.yaml` | Literally our staged file, rendered. |

> **Don't "fix" the model id to match `COPILOT_VENDOR_MODELS`.** That shipped catalogue
> (28 entries in `cli.py`) is misleading in both directions: `gpt-5.6-sol` is *absent*
> from it but resolves and runs fine, while `gpt-5` is *present* in it and fails. The
> live `GET /models` response is the only real authority. `_require_assets_model_selector`
> only checks that the `modelSelector` key exists — it never validates the id.

## Results and artifacts

```bash
msbench-cli report  --run_id <id>
msbench-cli extract --run_id <id> --output ./out
```

Assertion detail is in `eval.json`. Also captured: `screen_recording.mp4`,
`patch.diff`, `session.sqlite` (queryable with the same SQL as the assertions),
`extension-host.log`, and `customScript/output.log`. See
[AGENT_OUTPUTS.md](https://github.com/microsoft/vscode-copilot-evaluation/blob/main/doc/references/AGENT_OUTPUTS.md).

## Re-grading a past run for free

Changing a grader used to mean paying for a run to find out whether it still works.
[`regrade.ts`](regrade.ts) removes the model from that loop: it re-runs **today's**
graders against a run that already happened, for **zero tokens**.

```bash
export PATH="$HOME/.msbench-venv/bin:$PATH"
cd evals && npm run regrade -- 2026082582510393
```

```
  stored  regraded  assertion
  ----------------------------------------------------------------------
  = pass    pass      Agent should have written the requirements artifact
  = FAIL    FAIL      requirements.json satisfies the requirements contract
         exit 1 — PRODUCT FAILURE (bad artifact)
           FAIL: requirements.json satisfies the requirements contract — Expected …
  = pass    pass      Agent should not have written the dotfile variant
  …
No verdict changed. Today's graders agree with the stored eval.json.
```

This works because `session.sqlite`'s `files` table stores the **full text** of every
file the agent wrote, so the final workspace can be rebuilt on disk and re-judged. The
SQL assertions never needed the workspace at all — they only ever read that sqlite file.
`exec:` graders are re-run with cwd set to the rebuilt workspace, exactly as in-container,
and the `/agent/assets/graders/` prefix is rewritten to the working tree — which is what
makes them *today's* graders rather than the ones staged when the run happened.

The first invocation extracts to `.regrade/<run-id>` (gitignored) and reuses it after
that, so the iteration after the first is local and takes well under a second.

| Flag | |
| --- | --- |
| `--instance <id>` | Narrow to one instance. |
| `--extracted <dir>` | Re-grade an existing extraction; skips `msbench-cli` entirely. |
| `--config <path>` | Grade with a different config, to try an **edited assertion** against stored data. |
| `--keep-workspace` | Leave the rebuilt workspace on disk and print its path. |
| `--refresh` | Re-extract even when the cache has the run. |
| `--json` | Machine-readable report. |

Exit codes mirror [`graderHarness.ts`](../graders/graderHarness.ts): `0` every verdict
matches the stored `eval.json`, `1` at least one verdict changed, `3` a **harness fault** —
regrade could not run, a grader exited 3 or died abnormally, or an assertion query failed
to compile.

That last one is the point. MSBench collapses exit 1 and exit 3 into "non-zero", so a
grader that crashed looks identical to a product that misbehaved — see
[One fidelity gap worth knowing](#one-fidelity-gap-worth-knowing). `regrade.ts` keeps the
verdict column collapsed so the diff stays honest, but prints the attribution and exits 3
*regardless of whether the verdict moved*. A grader that breaks while still reporting
`FAIL` is otherwise invisible: the diff just says "unchanged".

The same rule catches [trap 2](#partial-re-runs-when-a-re-grade-isnt-enough)'s cousin — an
assertion query that no longer compiles reports as a fault rather than being laundered
into a product failure:

```
1 result(s) cannot be trusted — the harness broke, not the product:
  Agent should have written the requirements artifact: no such column: stepIndex
```

A run that was **rate limited** is refused outright: its `error.json` says `RATE_LIMIT`,
the agent produced nothing, and the run is void rather than red, so re-judging it would
only reproduce a wall of meaningless failures.

### Verified against known runs

Both re-grade to exactly their stored verdicts, which is the regression test for the tool
itself:

| Run | Stored | Re-graded |
| --- | --- | --- |
| [`2026082579322454`](https://msbenchapp.azurewebsites.net/run-analysis/2026082579322454) | 7/7, `resolved: true` | identical, exit 0 |
| [`2026082582510393`](https://msbenchapp.azurewebsites.net/run-analysis/2026082582510393) | 6/7, only `exec:` red | identical, exit 1 attributed as **PRODUCT FAILURE** |

### `vsc-eval`, and why there is a fallback

SQL assertions are re-run with `vsc-eval assertions assert --config-path … --database-file
… --output-file … --instance-id …`, byte-identical to what `run-agent.sh` does
in-container. But `@vscode/vscode-copilot-evaluation-agent` is **not on the public npm
registry** — it is built from the internal `microsoft/vscode-copilot-evaluation` repo. So:

- point `VSC_EVAL_BIN` at a local checkout's `dist/index.js` if you have one, and
- otherwise `regrade.ts` evaluates the compiled SQL itself with `node:sqlite`, using a
  direct port of `formatWithStepIndexFilter`.

The report says which engine ran. Both are verified against the stored `eval.json` above.

### Partial re-runs, when a re-grade isn't enough

Re-grading is the free half of the loop; re-running only what genuinely broke is the paid
half. Instances do come back `missing` (no output blob — infrastructure, not a model
verdict), so this is routine plumbing rather than exception handling.

Two traps, both of which cost real time:

- **`--benchmark <report>.json:error` takes no `@` prefix.** With `@` the CLI treats the
  whole token as a filename and dies with `Selection file not found: …results.json:error`.
  Selectors are `resolved`, `unresolved`, `error`, `missing`, plus `no_eval_or_error_json`
  and `no_error_json_unresolved` — the last two meaning *the harness broke, not the
  product*.
- **The status-selector form does not work for dataset-driven runs.** The report keys
  instances by a reformatted name (benchmark `vscbench`, instance `say_hello.<instance_id>`)
  while a custom `--dataset` declares its own benchmark name and bare instance ids, so the
  selector matches nothing and errors with
  `Instance 'say_hello.gpt_5_6_sol' not found in benchmark 'vscbench'`. Re-select
  explicitly instead:

  ```bash
  msbench-cli run … --benchmark <benchmark>.<instance_id> <benchmark>.<instance_id>
  ```

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
  regression at a glance. `run.sh` **exits 75 (`EX_TEMPFAIL`) with a loud banner instead
  of letting you read the results table**, so a throttled run cannot be mistaken for a
  regression. See [Is this run a result?](#is-this-run-a-result) for what it reports.

  Corroborate manually with `select name, count(*) from spans group by name` against
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
