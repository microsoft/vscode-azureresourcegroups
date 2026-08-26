# Running the agent evals on MSBench

The Vally suite in `evals/` runs the `azure-project-plan` agent headlessly through the
Copilot SDK. This folder runs the *same contracts* against the **real extension** in
**real VS Code** on [MSBench](https://aka.ms/msbench), via the `vscode` special agent.

The two are complementary, not redundant:

| | `evals/` (Vally) | `evals/msbench/` |
| --- | --- | --- |
| Runs | Copilot SDK, headless | Real VS Code + our VSIX |
| Tools | `program` graders over artifacts on disk | The extension's in-process MCP server |
| Webviews | Never opened | Actually rendered |
| Where | GitHub Actions, ~30 min | MSBench CES, with video + screenshots |
| Role | Fast PR gate | Nightly, pass@k, model sweeps |

Five stimuli from [`evals/project-plan/eval.yaml`](../project-plan/eval.yaml) are ported
here — the four **single-turn** ones and the first **multi-turn** one — with one config
per stimulus in [`config/stimuli/`](config/stimuli). `evals/project-plan/eval.yaml` stays
the source of truth; this folder is a port of it, so changes there need mirroring here
until the remaining two (multi-turn) stimuli are wired up.

| Stimulus | Turns | Assertions | Validator flags |
| --- | --- | --- | --- |
| `photo-app-requirements` (default) | 1 | 8 | — |
| `api-only-inventory` | 1 | 6 | `--assert-no-frontend --assert-blob-storage --assert-cosmosdb` |
| `multi-service-order-processing` | 1 | 5 | `--assert-service-count=3` |
| `no-datastore-converter` | 1 | 5 | `--assert-no-datastore` |
| `plan-generation-task-app` | 2 | 9 | — |

Assertion counts differ because they mirror each stimulus's graders one-for-one rather
than being levelled up — only `photo-app-requirements` specifies
`no-dotfile-requirements` and `transcript-not-contains`, and only it and
`api-only-inventory` specify `no-premature-plan`. `plan-generation-task-app` is the one
exception to one-for-one, and deliberately so: it carries a sentinel *per turn* and a
copy of the `reject_tools` constraint *per turn*, because a step-scoped assertion only
ever sees its own turn. See [Multi-turn stimuli](#multi-turn-stimuli).

The one assertion every stimulus carries that `eval.yaml` does not specify is the
**liveness sentinel**, `SELECT COUNT(*) > 0 FROM llm_responses`, which must be first.
It exists because a negative assertion (`COUNT(*) = 0`) is trivially true against an
empty table: a run that dies before the session database is populated would otherwise
collect full marks on every negative check rather than failing. It is a property of
*this* harness, not of the source spec, which is why it is not mirrored from there.

All four single-turn stimuli are verified by a real green run; ids are under
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
| `plan-generation-task-app` (2 turns) | [`2026082614813342`](https://msbenchapp.azurewebsites.net/run-analysis/2026082614813342) | **9/9**, `resolved: true` |

### What a second turn actually costs

`2026082614813342` is the first run here with more than one turn, so it is the first
number for the chain that is measured rather than extrapolated from single-turn runs.

| | Single-turn baseline (mean of 7) | `plan-generation-task-app` (2 turns) | |
| --- | --- | --- | --- |
| Total tokens (as reported) | 206.6k | **1,306.0k** | 6.3x |
| Total tokens (**incl. subagents**) | 206.6k | **1,575.7k** | 7.6x |
| Uncached input (as reported) | 22.4k | **87.3k** | 3.9x |
| Uncached input (**incl. subagents**) | 22.4k | **221.7k** | 9.9x |
| Cached input | — | 1,188.9k (93.2% of main input) | |
| Output | — | 29.8k (+11.9k in subagents) | |
| Steps | 5–10 | **18** | |
| Agent time | — | 465s (7m46s) | |
| `output.zip` | — | ~9.5 MB (50 MB unpacked) | 0.9% of the 1 GiB ingest limit |

> **`msbench-cli report` undercounts, and the gap is worst on the number you care about.**
> Its totals are the **main trajectory only**. This run made 4 `runSubagent` calls, each
> of which produced its own trajectory file with its own spend — 257.8k prompt and 11.9k
> completion tokens that appear in **no** headline figure. That is +20.7% on total, but
> **+154% on uncached**, because a subagent starts a fresh context and so caches badly
> (47.9% cached, against the main trajectory's 93.2%). Sum
> `trajectories/*.trajectory.json`, not just the report, or every subagent-heavy phase
> will look cheaper than it is — and scaffold is expected to use more of them, not fewer.
>
> **This failure is silent.** You do not get an error or an obviously odd figure; you get
> a plausible number that is 20% low on total and 154% low on uncached. Nothing about the
> report says a trajectory was omitted.
>
> **It applies to anything downstream, including Kusto.** Trend reporting, cost
> dashboards and model sweeps built on *either* `msbench-cli report` totals *or* ATIF's
> `final_metrics` inherit the same blind spot — and once a trend series is accumulating
> under-counted points it is far harder to notice, and to correct retroactively, than it
> is to sum the sub-agent files up front. See
> [The run already emits an ATIF trajectory](#the-run-already-emits-an-atif-trajectory).

**One extra turn does not cost one extra turn.** Doubling the turns multiplied total
tokens by 6.3x as reported and 7.6x once subagents are counted, because every step
re-sends a transcript that is itself growing — turn 1 wrote `project-plan.md` plus ~48 KB
of `.preview-temp/` mock-ups, and all of it rides along in each subsequent request.
Marginal cost per step was previously measured rising at 24.5k → 26.8k → 35.5k; this run
is **72.6k tokens/step** as reported, **87.5k/step** including subagents, and the marginal
cost of the 10 steps beyond the single-turn baseline is **~110k tokens/step**. The curve
steepens; it does not flatten.

Uncached input is the gentler number *in the main trajectory* (3.9x) because the cache
absorbs 93.2% of input, so **billed cost and context pressure diverge** — quote whichever
one the question is actually about. But that reassurance is mostly an artifact of ignoring
subagents: counted properly, uncached grew **9.9x**, which is worse than the total. Note
also that ~30% of chat spans went to `gpt-4o-mini` rather than the model under test (14 of
46), so not every span is a step of the task.

Extrapolating to the full 6-phase chain is where confidence drops sharply — see
[Extrapolating to the full chain](#extrapolating-to-the-full-chain).

### The run already emits an ATIF trajectory

`output/trajectories/trajectory.json` is a genuine **`ATIF-v1.6`** document, written by the
VS Code agent without us asking for it. That matters because the per-step accounting this
section had to reconstruct from `session.sqlite` and `agent-traces.db` is already in there,
structured:

```
final_metrics:  total_prompt_tokens 1276211   total_completion_tokens 29790
                total_cached_tokens 1188942   total_reasoning_tokens   1210
                total_steps              19   total_tool_calls           22

steps[1]:  prompt_tokens 33185  completion_tokens 323  cached_tokens 9952
           reasoning_tokens 121  time_to_first_token_ms 1753  duration_ms 6548
```

Every step carries `prompt_tokens` / `completion_tokens` / `cached_tokens` /
`reasoning_tokens` / TTFT / duration, so **per-step cached-token accounting is free** —
that is the marginal-cost curve above, directly, rather than inferred from run totals. The
`final_metrics` cross-check exactly against `msbench-cli report` (1,276,211 / 29,790 /
1,188,942), and ATIF additionally surfaces `total_reasoning_tokens`, which the report
tables do not show at all.

Three reconciliations to know before trusting it:

| | ATIF | Elsewhere | Why |
| --- | --- | --- | --- |
| Steps | 19 | 18 (`report`) | ATIF counts the opening user message as `steps[0]`; it carries no `metrics`. The 18 metric-bearing steps are the report's steps. |
| Tool calls | 22 | 32 (`session.sqlite`) | Sub-agent tool calls live in their own trajectory files, and even summing all five reaches only 26. **`session.sqlite` is the authority for tool calls.** |
| Tokens | main only | main only | Neither ATIF's `final_metrics` nor the report includes the four sub-agent trajectories. Sum them yourself. |

Each `runSubagent` call writes `trajectories/toolu_<id>.trajectory.json`, a complete ATIF
document of its own (3 steps, ~63k prompt, ~30k cached each here). Those four files are the
+20.7% total / +154% uncached documented above.

**Anything ingesting these must sum `trajectories/*.trajectory.json`, not just
`trajectory.json`** — Kusto trend reporting, cost dashboards and per-model sweeps included.
An ingestor reading only the main trajectory (or only `msbench-cli report` totals, which
have the same blind spot) will systematically under-report exactly the phases that lean on
sub-agents, and it will do so silently: the series looks well-formed, just low. Scaffold and
deploy delegate more than planning does, so the error grows with the phases we have not
measured yet — and a trend built on under-counted points is much harder to correct after the
fact than to get right now.

### Extrapolating to the full chain

Straight-line from 2 phases to 6 gives ~3.9M total tokens and ~262k uncached on the
reported figures — or **~4.7M total and ~665k uncached once sub-agents are counted** — and
~23m of agent time. **That is almost certainly an underestimate, and it should not be
planned against.** Confidence is low, for reasons worth stating plainly:

- **n=1.** One run, one model, one prompt. No variance estimate at all.
- **The two *cheapest* phases were the ones measured.** Requirements and plan write two
  text artifacts. Scaffold, build, local-dev and deploy write whole trees and shell out —
  this run already spent 6 `run_in_terminal` and 4 `runSubagent` calls in turn 1 alone.
  Sub-agents are the sharp end: they cache badly (47.9% vs 93.2%), they are invisible in
  every headline figure, and scaffold is expected to use *more* of them.
- **Growth is superlinear, and linear extrapolation assumes it isn't.** Per-step cost
  doubled between the single-turn baseline and this run.
- **Context, not cost, is the likelier wall.** 1.28M input tokens across 18 steps means
  the per-request transcript is already large; a 6-phase chain risks compaction or a
  context limit before it exhausts any token budget, and compaction changes behaviour
  rather than just price.
- **Wall-clock has a hard ceiling the token budget doesn't.** `npm install` and
  `azd provision` are slow *and* quiet, which is `stallSeconds` territory (90m), under a
  runner cap that [looks like 2h rather than 6h](#timeouts).

`output.zip` is the one risk that looks comfortable: 9.5 MB here, and the bulk is logs
(`agent-traces.db` 9.2 MB, `chat-export-logs.json` 8.7 MB, `extension-host.log` 8.3 MB)
which scale with steps, not wall-clock — `screen_recording.mp4` was only 1.9 MB. Even a
10x chain lands around 100 MB, an order of magnitude below the
[1 GiB ingest limit](#a-missing-instance-is-probably-an-oversized-artifact) where the
ingestor rejects the artifact deterministically on every retry and the run reads as a
missing blob.

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

> **The observed runner cap is 2h, not 6h — so `agentSeconds: 18000` is mis-derived.**
> The instance runlog for `2026082614813342` says, verbatim, immediately after the
> benchmark banner and before the agent starts:
>
> ```
> containerName=vscbench.eval.x86_64.say_hello
> ==== START BENCHMARK RUN ====
> /entry.sh exists
> Starting runner using entry.sh
> Using timeout of 7200 seconds
> Runner script finished!
> ```
>
> That is the outer runner applying a 2h timeout to `entry.sh` — the process that contains
> the whole agent session — and the 5h `agentSeconds` above was derived from an *assumed*
> 6h cap. If 7200s is the real per-instance limit then the agent budget is 2.5x the
> runner's, which is precisely the failure this section warns about: the job is killed
> first, the agent timeout never fires, `runnerGraceSeconds` never runs because it only
> starts *after* the agent timeout, and nothing is flushed on the runs that most need
> diagnosing. Re-derived from the observed cap, the arithmetic gives `7200 − ~15m setup −
> 15m grace ⇒ ~1.5h agent (5400s)`.
>
> This is left unchanged pending confirmation rather than fixed here, for two reasons:
> it is one observation, and the line does not say whether 7200s is fixed per instance
> or something the orchestrator sets per dispatch. Nothing has come close to it yet — the
> longest run to date is 49m and `2026082614813342` used 465s of the 7200s (6.5%) — so
> this is a latent trap rather than an active one. It becomes active on exactly the long
> chain runs this timeout section exists for. Worth confirming with
> <CodeExService@microsoft.com> before the scaffold and deploy phases get wired up.

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
| `assets/user-overrides.yaml` | `build-config.ts` | `config/base.yaml` + `config/phases/<phase>.yaml` + `config/stimuli/<name>.yaml` |

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
agent-seeding `script:`) is copied into four files or written once. It is written once
and concatenated with a stimulus file. The merge is textual rather than a YAML
round-trip so that the explanatory comments survive into the generated file — the
sources define disjoint top-level keys, and `build-config.ts` fails if that ever stops
being true. That failure is deliberately hard rather than a last-one-wins override: a
silent override turns a typo in a stimulus into a run that starts, costs money and
grades the wrong thing.

### The three layers

The shared preamble is split in two, because not all of it is shared by everything:

| Layer | Holds | Changes with |
| --- | --- | --- |
| `config/base.yaml` | model, timeouts, VSIX install, auto-approval | nothing — true of every run |
| `config/phases/<phase>.yaml` | `chatMode`, `snapshotWorkspace`, the workspace-seeding `script:` | which **product phase** is under test |
| `config/stimuli/<name>.yaml` | the prompt and its assertions | the individual case |

The middle layer exists because the phases are not interchangeable. The `plan` phase
starts from an empty workspace. The `scaffold` phase needs an approved
`.azure/project-plan.md` already on disk, and must set `snapshotWorkspace: false`
because it runs a real `npm install` — a per-step snapshot would copy `node_modules`
into `session.sqlite` after every step, which is the multi-gigabyte case the schema
warns about. The `local-dev` phase needs a whole scaffolded project. Those differences
are shared by every stimulus in a phase and differ between phases, which is exactly the
shape that gets copy-pasted and then drifts.

A stimulus picks its phase with a `# phase: <name>` directive in its header. Omitting it
means `plan`, so a stimulus that predates the layer needs no change.

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
automatically so an assertion only sees its own turn — which is what makes the
multi-turn stimuli straightforward. `llm_responses.response` is user-facing prose
only, excluding tool output and thinking blocks, so substring assertions don't
false-match text the agent merely read.

## Multi-turn stimuli

`promptSteps` is natively multi-turn: each entry is one user message into the **same**
chat session, and each carries its own `assertions`. `plan-generation-task-app` is the
first stimulus here to use more than one, porting stimulus 1.5 from `eval.yaml`.

The mechanism is `SQLiteAssertionDatabase.formatWithStepIndexFilter` (ported verbatim
into [`regrade.ts`](regrade.ts)): `:stepIndex` is bound to the index of the step an
assertion is **declared under**, and the filter is appended to the query. So *where an
assertion lives is a load-bearing decision*, not a formatting one. An assertion under
the wrong step still passes — it just stops meaning anything, which is the failure this
folder keeps having to design against.

Three rules fall out of that, and all three are things a naive port gets wrong:

1. **A grader marked `turn: N` in `eval.yaml` goes under `promptSteps[N]`.** An
   untargeted Vally grader reads the whole trajectory and the final workspace
   (`executor/azure-agent-executor.ts` sends every turn into one session and grades once),
   so it goes under the **last** step. For the plan graders that is also a slightly
   stronger claim than the source makes — the plan must be written *in the turn after
   confirmation*, not merely exist by the end — which is the actual product contract.
   The `files` table is a **per-step snapshot, not a delta**, measured in run
   `2026082614813342`: `.azure/requirements.json` appears at both step 0 and step 1 with
   identical bytes, while `.azure/project-plan.md` appears at step 1 only. So a
   `file-exists` under the last step is exactly Vally's final-workspace semantics, and a
   `file-not-exists` under step 0 is a genuine approval-gate check rather than a
   statement about write ordering.
2. **One sentinel per turn.** The single sentinel from
   [PR #1706](https://github.com/microsoft/vscode-azureresourcegroups/pull/1706) only
   proves *some* turn ran. The multi-turn version of that bug is a run that completes
   turn 0 and then dies — throttled on the second turn, or stalled. A step-0 sentinel
   still passes, while every step-1 negative assertion passes vacuously and the step-1
   positives fail as though the product were broken. Bound to `:stepIndex = 1`, the
   second sentinel asserts the second turn actually happened.
3. **A whole-conversation constraint needs a copy per turn.** `constraints.reject_tools`
   applies to the entire Vally trajectory, but each ported copy sees exactly one turn, so
   a single copy silently leaves the other turn unchecked. The duplicate also buys
   attribution: the failing assertion names the turn that misbehaved.

`enableImpliedStepIndexFilter: false` turns the filter off for one assertion, which would
express rule 3 as a single whole-conversation check and preserve the one-for-one grader
mapping. It is deliberately **not** used yet — it is unverified against the harness
version we run, and a config the runner rejects costs a whole run to discover. Plain YAML
that cannot fail schema validation is worth one extra assertion.

`exec:` needs the same care for a different reason: it runs **after the step it is
attached to**. The two plan validators are declared under the last step because attached
to step 0 they would run before `.azure/project-plan.md` exists and go red for a reason
that has nothing to do with the product.

Assertions can be compile-checked before spending a run, which catches
[trap 2](#partial-re-runs-when-a-re-grade-isnt-enough) — the filter is appended
unconditionally, so an assertion that isn't a real table query dies with
`X_ASSERTION_DOES_NOT_COMPILE` and takes the run with it.

### That the scoping discriminates, measured

Turn-scoped assertions are the "looks fine, means nothing" risk: one attached to the
wrong step still passes. Run `2026082614813342` shows the scoping doing real work rather
than being satisfied by whichever turn happened to be convenient —

```
toolCalls    step0=6   step1=26
files        step0=155 step1=162     (snapshot per step, not a delta)
llm_responses step0=1  step1=1
exec         step1=3                 (both validators + the fingerprint)

step0  mcp_copilot_azure_open_requirements_view x1
step1  mcp_copilot_azure_open_plan_view         x1
```

Each webview tool is called in exactly one turn, and it is the turn its assertion is
bound to. `exec` rows exist only for the step the graders are declared under, which
confirms `exec:` runs per-step — the reason the two plan validators cannot live on
step 0.

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


## Run queueing

**If you submit MSBench runs for this eval by any route other than `run.sh`, use exactly
these two values:**

| Key | Value | Where it comes from |
| --- | --- | --- |
| endpoint tag | `copilot-on-rails` | `--tag endpoint=copilot-on-rails` (set by `run.sh`) |
| model | `claude-sonnet-4.5` | derived from `modelSelector` in [`config/base.yaml`](config/base.yaml) |

CES serialises runs that share the same **(model, endpoint tag)** pair: the second one
waits in a queue rather than racing the first for the same model capacity. Unqueued runs
race — ours against each other, and against any other team on the same model.

The catch is that **there is no validation of these strings**. A run tagged
`copilot_on_rails`, `CopilotOnRails`, or `copilot-on-rails ` is accepted, submitted, and
put in a *different* queue, where it races the runs it was supposed to wait behind.
Queueing then silently does nothing and looks exactly like it is working. That is the
whole reason the values are written down here.

We were opted out by omission until [#1707](https://github.com/microsoft/vscode-azureresourcegroups/pull/1707):
`run.sh` set no endpoint tag at all.

### Why the model half needs no flag

`--model .` is `ASSET_MODEL_SENTINEL`. It does **not** mean "no model" — it tells the
`vscode` plugin to read `modelSelector` out of the staged `assets/user-overrides.yaml`
instead of resolving one itself, and the plugin hands the result back as
`resolved_model`. The CLI then sets `agent_config.model` from it
(`model_source: agent_assets`). A dry run confirms the sentinel is resolved before
submission, not passed through:

```
"model": "claude-sonnet-4.5",
"model_source" ... "resolved_model": "claude-sonnet-4.5",
"runner_notes": [
  "modelSelector set in user-overrides.yaml; using it because --model . was supplied.",
  "modelSelector in user-overrides.yaml: copilot/claude-sonnet-4.5."
]
```

So `--model .` is fully compatible with queueing, and keeping it is required for other
reasons (see "Why the VSIX route"). The consequence is only that the model half of the
queueing key lives in `config/base.yaml` rather than on the command line.

### Never pass `--parallel_repeats`

`--parallel_repeats` exists **specifically to drop the endpoint tag** so repeat attempts
can run concurrently — it is the documented opt-*out* of queueing. Using it with this
eval un-does everything in this section.

It cannot be passed accidentally: `run.sh` always sets the endpoint tag, and the two are
mutually exclusive, so the CLI refuses the run outright rather than quietly dropping the
tag:

```
$ ./run.sh --repeat 2 --parallel_repeats
ERROR --parallel-repeats cannot be used with an endpoint tag. Remove the endpoint tag
      to allow CES to schedule repeat attempts in parallel.
```

For the same reason `run.sh` appends its `--tag` **after** any pass-through arguments:
CLI tags are last-wins, so a caller's `--tag endpoint=...` is overridden by ours (with a
`Duplicate tag endpoint; overriding` warning) rather than the other way round.

### This is not a rate-limit fix

Queueing stops our runs racing each other and it is the mechanism MSBench documents for
this, which is reason enough to switch it on. But it is **not established** that it fixes
the 429s described in "Is this run a result?". Those appear to come from
`FrontDoorLimiter`, a per-user *request-count* limiter in `copilot-api` — not from
exhausting token quota, since this eval uses roughly 0.1% of the 31M TPM allocated to the
`autodev-test` integration. Serialising our own runs does not obviously change a
per-user request-rate ceiling. Treat the effect on throttling as unmeasured until a run
demonstrates otherwise; `verify-run.ts` and its exit 75 are still the safety net.

## Smoke mode is pinned off

`run.sh` passes `--smoke_mode none`.

Smoke is a CES preflight for multi-instance runs: it takes the **first requested
instance**, executes it for real — same image, runner, credentials, agent package and
model — and only then fans out to the rest. It is a real instance consuming real tokens
and a real slot.

**This is currently a no-op.** Smoke is opt-in and off by default in msbench-cli
`0.3.54`; a dry run reports `"smoke_mode": "none"` with the flag absent. It is pinned
anyway because the wiki states the default will flip to on for eligible runs, and
`--smoke_mode none` is documented as the opt-out that remains after that flip.

The reason to pin it *now* rather than when it flips: **smoke only applies to runs with
more than one instance.** It is inert while we submit one stimulus per run, and would
start silently duplicating a full end-to-end scenario the moment we stop — which is the
direction this eval is heading. The cost lands exactly when it is least affordable.

What we give up is an early setup-validity check. That is a reasonable trade here: it
earns its keep when a bad agent package or missing credential would fail every instance
identically, and `run.sh` already checks the VSIX for `resources/agents/` and
`dist/extension.bundle.js` and regenerates the config locally before submitting.

The flag is placed **before** `"${PASSTHRU[@]}"`, so `./run.sh --smoke_mode auto` still
works if you deliberately want it.

> There is no `MSBENCH_DISABLE_SMOKE_TEST` environment variable. It appears in an older
> *proposed* version of the wiki page; it does not exist in the shipped CLI, and setting
> it does nothing. `--smoke_mode` is the real control.

## A `missing` instance is probably an oversized artifact

**This is the most likely cause of a `missing` instance, and it is not flaky
infrastructure — it is deterministic.**

MSBench's artifact ingestor reads each GitHub Actions artifact **fully into memory**
(`ArtifactIngestor.ReadArtifactStreamToMemoryAsync`) and rejects anything over a
**1 GiB** cap:

```
Artifact <name> (id=…) … size <N> bytes exceeds maximum allowed 1073741824 bytes
```

An `output.zip` over 1 GiB therefore fails **every retry identically**. After
`MaxDequeueCount = 5` the message is moved to the `artifact-ingestion-poison` queue and
that artifact is **never** reconciled into blob storage — it reads as a missing blob for
that instance. The run itself looks fine. The results are simply gone.

We are a strong candidate to hit this: each run captures a screen recording, trajectory
data and `session.sqlite`, over a session budgeted at up to five hours.

**The first multi-turn run puts a number on that risk, and it is smaller than feared.**
`2026082614813342` produced a **~9.5 MB `output.zip`** (50 MB unpacked) — 0.9% of the
cap. More useful than the number is the composition: the bulk is logs that scale with
*steps* (`agent-traces.db` 9.2 MB, `chat-export-logs.json` 8.7 MB, `extension-host.log`
8.3 MB), while `screen_recording.mp4` — the artifact the five-hour budget makes scary —
was only **1.9 MB** for a 7m46s run. Even a 10x chain lands near 100 MB. So this stays
worth watching as the chain grows, but on current evidence it is an order of magnitude
away, and a `missing` instance today is more likely something else. See
[What a second turn actually costs](#what-a-second-turn-actually-costs).

To confirm rather than assume, query the ingestor's App Insights (the queue depth is not
in Kusto) for the run's window:

| Field | Value |
| --- | --- |
| Cluster | `https://ade.applicationinsights.io/subscriptions/d0c05057-7972-46ff-9bcf-3c932250155e/resourcegroups/CodeExecService/providers/microsoft.insights/components/msbench-kusto-ingestor-func-prod-ai` |
| Database | `msbench-kusto-ingestor-func-prod-ai` |
| Tables | `traces` (poison-move lines), `exceptions` (op `ArtifactIngestionTrigger` — the real failure) |

### Why we cannot currently bound it

Both obvious levers are unavailable, so this is documented rather than fixed:

- **Screen recording cannot be shortened or disabled.** `TestConfig.schema.json` has no
  `screenRecording`/`recording` property — nothing matching `record`, `video`, `mp4`, or
  any artifact size limit. There is no supported setting to turn it down.
- **`snapshotWorkspace: false` would fail our runs fast, by design.** It defaults to
  `true` and its own schema description warns it "can produce multi-gigabyte
  `session.sqlite` files" — precisely our risk, since these stimuli run a real
  `npm install` and build, so `node_modules` lands in the snapshot. But the schema also
  says the run **fails fast if snapshotting is disabled while any assertion queries the
  `files` table**, and *every* stimulus does:

  ```
  SELECT COUNT(*) > 0 FROM files WHERE path LIKE '%.azure/requirements.json'
  ```

  Turning it off means first rewriting every artifact assertion in all four stimuli from
  SQL to `exec:`. That is a much larger change than a size guard and would alter what the
  eval measures, so it is deliberately not done here.

If a run ever does come back `missing`, check the artifact size before filing it as
platform flakiness. The upstream fix — stream oversized artifacts to blob instead of
buffering, and fail soft on one bad artifact — sits with the MSBench KustoIngestor team.

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

## Auditing the gates themselves

[`gate-health.ts`](gate-health.ts) audits the **instrument** rather than the product. It
reads past runs and asks, per gate, whether that gate has ever actually done its job.

```bash
export PATH="$HOME/.msbench-venv/bin:$PATH"
cd evals && npm run gate-health                    # every run in the local cache
npm run gate-health -- 2026082579322454 …          # specific runs, extracted on demand
```

The motivating case comes from the sibling suite in #1669: its `worker` gate recorded
**16 failures and zero passes across every run ever executed** before anyone noticed the
storage probe was signing its Azurite requests with a corrupted account key. Azurite
answered 403 to everything, so no generated app could have passed regardless of quality.
Ten percent of the corpus was being charged for a harness defect. *A gate that has never
once passed is far more likely to be broken than the product is to be uniformly incapable
of exactly that one thing.*

| Verdict | What it suggests | What to do |
| --- | --- | --- |
| `never-passed` | The gate may be impossible to satisfy — broken probe, wrong credential, bad fixture | Re-grade the named run and read the grader's own stderr |
| `never-failed` | The gate may be vacuous; it has never discriminated | Check it can go red at all; certification is the cheap way |
| `always-not-applicable` | Declared `class=outOfScope` every time — the gate was wired to a stack it cannot answer for | Fix the stack wiring; only consider deleting if it's out of scope everywhere |
| `never-attempted` | The gate never got the chance to run — cascade, or `class=environmentGap` | Fix what is upstream or install the prerequisite; the gate is not the problem |
| `healthy` | Has both passed and failed | Nothing |

**None of these prove a defect.** Each is a reason to look before quoting a score.

### How to read a verdict: the sentinel, right now

The liveness sentinel is a worked example, and it is in the report today. It is declared in
**all five stimuli** and appears in **zero of the 21 runs audited**, so it reports as
*declared but never seen*. That is correct and entirely benign — every run in the corpus
predates #1706, which added it.

It is also the useful half of the lesson. **The verdict is expected to resolve on its own:**
the scaffold runs being submitted now are the first that will carry the sentinel. If it is
*still* never-attempted once those have landed, that is a real bug rather than a historical
artifact, and the same verdict means something completely different.

That is how every verdict here should be read — as a question with a date on it, not a
finding. "Has never passed" is only interesting relative to *when the gate was last changed
and which runs have happened since*, which is why `--min-runs` and explicit run scoping both
exist.

### How many runs before a verdict means anything

Verdicts resting on fewer than `--min-runs` runs (default **3**) are printed but marked
`(low confidence)` and never fail the process. This matters more than it sounds: on the
current corpus **25 of 30 gates are `never-failed`**, which is what a young suite looks
like, not a broken one — most gates have one to fourteen observations. The number to watch
is whether that ratio survives corpus growth, not its value today.

Only a `never-passed` gate with at least `--min-runs` runs sets exit **1**.

### The four inputs, and what had to be inferred

#1669 read a `cor-validation.json` carrying a per-gate `status` and an explicit
`notAttempted` flag. **No such file exists here.** MSBench records only `passed: true |
false` plus a nullable `error`, so every distinction is reconstructed from four artifacts
of an extraction:

| Input | Gives |
| --- | --- |
| `vsc-output/eval.json` → `details[]` | the verdicts; the only gate name MSBench carries is the assertion comment |
| `vsc-output/session.sqlite` → `exec` table | exit **1** vs exit **3** offline, and the N/A marker on stderr |
| `output/error.json` → `type` | the instance was **void** — see below |
| `vsc-output/configs/final-agent-config.json` | declared assertions, so a run with **no `eval.json` at all** still names the gates that never ran |

The `assertions` table in `session.sqlite` is always empty; `eval.json` is the authority.

### Void instances corrupt the tally in both directions

#1669's cascade is per-gate, matched on the prose of a failure reason. Ours is structured
and coarser: `error.json` marks a whole instance void. Every verdict in a void instance is
discarded — **including the passes**, which is the part #1669 does not model.

That is not theoretical. Two runs in the current corpus:

| Run | Fault | Recorded | What actually happened |
| --- | --- | --- | --- |
| [`2026082583236973`](https://msbenchapp.azurewebsites.net/run-analysis/2026082583236973) | `RATE_LIMIT` | 1/4 — including a **pass** for `Agent should not fall back to the chat question tool` | The agent produced **literally nothing**. A `COUNT(*) = 0` assertion is trivially true against an empty table. |
| [`2026082467189297`](https://msbenchapp.azurewebsites.net/run-analysis/2026082467189297) | `X_EXTENSION_ACTIVATION_ERROR` | 4/7 | **All four "passes" are the negative assertions**; all three "failures" are the extension never activating. |

So a naive pass rate over these manufactures failures the product never earned *and*
credits passes it never earned. **Seven of twenty-six instances in the corpus are void.**

> **Any run predating #1706 may contain vacuous passes.** The liveness sentinel added
> there fails such runs outright, but only going forward. Anyone re-grading or
> trend-plotting historical runs should assume the older half of the corpus is
> contaminated in both directions.

### Why this has to be mechanical

The argument for automating any of this is not that people are careless. It is narrower and
less comfortable than that.

Over one afternoon of building these gates, **four separate participants across three
sessions reached a confident conclusion while the disconfirming evidence was in their own
output.** Not evidence they lacked — evidence they had printed, and read past:

- A run was declared to have a member-order bug; the timestamp disproving it was in the
  same `ls` output as the claim.
- A check was proposed for detecting stranded commits; the line disproving it (`all nine
  commits listed, because a squash rewrites them`) had been printed one step earlier.
- A refined version of that check was proposed after testing only the case where it works.
- The `unzip -l` listing used to explain a 25-minute-old read described the archive as it
  existed *after* the read.

The pattern is not fatigue. **A plausible mechanism is more satisfying than an unexplained
observation**, so the mechanism gets adopted and the observation gets quietly re-read to
fit. Every one of those five hypotheses was mechanically sound and predicted the symptom.

That is the same failure this tool exists to catch, one level up. A gate that has failed 16
times looks routine; nothing about a routine-looking thing invites inspection, which is
precisely why nobody inspected it. *"It looked routine"* was also the reason a branch got
squash-merged while it was still receiving commits, losing a commit for thirty minutes.

So the verdicts here are deliberately computed rather than judged, the report states how
many runs each one rests on, and it refuses to editorialise below a threshold. Not because
judgement is bad, but because judgement is exactly what stops being applied to things that
look fine.

#### A related check, and what it does not know

After a squash merge, this finds content on a branch that did not make it in. `git log
feat/CoR..<branch>` does **not** work — a squash rewrites every commit, so it lists the
whole branch every time, which is an alarm that always fires:

```bash
base=$(git merge-base origin/feat/CoR "$BR")
touched=$(git diff --name-only "$base" "$BR")
git diff --numstat origin/feat/CoR "$BR" -- $touched |
  awk '$1>0 {s+=$1; print "  +"$1"\t"$3} END {print (s ? "STRANDED "s : "no additive content stranded")}'
```

Restricting to files the branch touched matters: without it, lines that *other* merged PRs
deleted show up as insertions on any stale branch — 80 reported against 62 real, in the
case this was built for.

Two limits, both stated rather than fixed, because a second noisy column would be worse:

- **It counts insertions only, so a lost *deletion* reports success.** That is why the
  success string says `no additive content stranded` and not `clean` — the check examined
  half the branch and must not render a verdict on all of it.
- **Non-zero is a reason to look, not a finding.** Content a later PR legitimately
  superseded is indistinguishable from content a squash dropped. Of three real non-zero
  results, two were benign.

### Not-applicable, and the convention that got reversed

The fidelity and runtime gates emit a machine-readable marker on stderr:

```
NOT_APPLICABLE gate=<gate-id> class=<outOfScope|environmentGap> reason=<reasonCode> detail="…"
```

**and exit 3**, which MSBench records as `passed: false`. So an N/A is scored as a
**failure**, and a gate that is N/A across the whole corpus reads **0-for-16** — the story
at the top of this section exactly, except this time the gate is fine and the environment
is the problem. That is live rather than hypothetical: the five `runtime-*` gates emit
`functionsHostUnavailable` on *every* current stimulus, because all four are Azure
Functions and the container has no `func` binary.

**It was very nearly the opposite, and the reversal is worth recording.** Exit 0 was ruled
first, explicitly on the grounds that this tool's always-not-applicable verdict made it
safe. That premise was false. MSBench writes `exitCode = 0` as `passed: true`, `resolved`
derives from it, and the run-analysis site, `msbench-cli report` and Kusto all publish that
number — so this report could say "not applicable" while the headline said green, and
**nobody investigates green**. Observing inflation is not the same as being able to undo
it. The ruling was reversed on that basis: exit 3 is *pessimistic and recoverable*, exit 0
was *optimistic and unrecoverable*.

MSBench assertions are binary — there is no "neither" — so neither convention can be fixed
at the assertion layer, and this report stays the only place N/A is visible as N/A. Three
behaviours are therefore a **contract**, not a preference. If you are tempted to simplify
any of them, this is what you would be breaking:

1. **N/A is its own bucket**, alongside passed / failed / notAttempted. Never folded into
   `passed` — and, under exit 3, **never folded into `failed`**, which is now the live risk
   and would charge the product for a missing binary.
2. **Every rate excludes N/A from both numerator and denominator.** A gate that ran 16
   times, was N/A 16 times and passed 0 real times has *no applicable observations* — the
   `rate` column prints `n/a`, which means nothing was judged, not 0% and not 100%.
3. **Always-N/A gates are grouped by `reason=`.** Under exit 3 this is what separates "five
   gates are broken" from "one binary is missing, here is the install command".

Detection keys off the **marker, not the exit code** — which is why reversing exit 0 to
exit 3 needed no code change at all. One ordering detail matters: the marker is checked
*before* the exit-3 grader-error branch, so a genuinely crashed grader (exit 3, no marker)
stays distinct from a not-applicable one.

#### The two classes, and why the split is mechanical

`class=` is on the line rather than in a lookup table here, so a new reason code cannot
silently default into the wrong bucket. Each gate family owns its own reason-to-class
mapping, so adding a reason is never a shared edit.

| `class=` | Means | Tallied as | Because |
| --- | --- | --- | --- |
| `outOfScope` | The gate should not have been wired to this stack — `noFrontendDeclared`, `noHealthPathDeclared` | `notApplicable` | Applicability is a wiring-time decision; seeing it at runtime is a config bug with an owner |
| `environmentGap` | The gate applies, the machine cannot run it — `functionsHostUnavailable`, `ecosystemNotSupported` | `notAttempted` | Nobody decided the gate was unnecessary; we genuinely are not testing something we claim to |

Note which side `ecosystemNotSupported` sits on, because it is the instructive one. A Go
project is **not** a scenario with nothing to test — it has a plan, a tree and a real
fidelity question; we simply have no analyser for it. Classified `outOfScope` it would tell
someone to delete the datastore gate because it keeps not applying to Go, when the correct
action is to write the Go analyser. The producer owns that judgement, which is exactly why
this tool buckets on `class=` and never on the reason code.

An unrecognised or absent `class=` is read as `environmentGap`. That is the safe direction:
it reports "something is in the way" rather than "this gate should not be here".
`noProjectManifestFound` is the case that motivates it — it most likely means the tree was
never staged, and reporting that as a wiring or scope problem would invite deleting a gate
to fix a staging bug.

Note what `always-not-applicable` does **not** license. Because applicability is decided at
wiring time, a gate reporting `outOfScope` is a **wiring bug with an owner** — it was
attached to a stack it cannot answer for. Beyond that, this report can only ever say *out
of scope for the stacks actually observed*. "Dead weight everywhere, delete it" is a claim
about coverage that the report has no evidence for: it sees the runs it was given, not the
set of stacks that exist. Overstating it once would teach people to discount the verdict
entirely, so it deliberately stops short. Read the stack declarations before removing
anything.

A reason meaning *"we tried and it did not work"* does not belong on this path at all. That
is a product failure and must go red; routing one through N/A turns a real bug into a
self-suppressing green. Naming matters here too: a reason code that describes a harness
capability gap as though it were a product outcome tells the reader not to investigate.

### Gate identity, and a known limitation

MSBench carries no gate id — `eval.json` identifies an assertion only by its comment. That
is unstable: `requirements.json should be valid JSON carrying a questions array` and
`requirements.json satisfies the requirements contract` are **the same gate** before and
after it moved from SQL to `exec:`, so under comment identity it appears as two gates with
7 and 3 runs rather than one with 10. **A gate can silently reset its own history by being
reworded.**

The default `--identity gate` mitigates this by keying `exec:` gates on the grader's
filename — the same id `gate=` is derived from, and the same id the certification manifest
uses — which also recovers a stable identity for runs recorded *before* the convention
existed. The difference is measurable on the current corpus: under comment identity the
four `validate-requirements.ts` variants appear as four separate rows, three of them
`never-failed` on one or two runs each; under grader identity they are one `requirements`
gate reading **5 pass / 1 fail / 7 runs / healthy**. Same data, and only the second is true.

Two consequences worth knowing:

- It is deliberately **coarser**: every `validate-requirements.ts` invocation is one gate
  regardless of its flags. Use `--identity comment` for the raw per-assertion view.
- **It is a partial fix, and the larger half is untouched.** Filename identity stops
  `program`/`exec:` gates from getting worse. SQL assertions over `files` / `toolCalls` /
  `llm_responses` have no stderr and no grader file, so they keep comment identity — and
  they are the majority of gates.

That second point is measured, not feared. Three pairs in the current corpus are one gate
wearing two names, because sibling stimuli word the same assertion differently:

| | |
| --- | --- |
| `Sentinel; …or the negative checks below are vacuous` | `Sentinel; …or every check below is vacuous` |
| `Agent should not open the plan view to approve the plan itself` | `Agent should not take over planning by opening the plan view` |
| `Agent should not fall back to the chat question tool` | `Agent should refuse with a message, not by asking a chat question` |

All three are SQL assertions, so no identity scheme available here can merge them, and the
count grows as stimuli are added. **The actual fix is upstream**: one canonical string per
shared gate plus a drift check that fails when a stimulus deviates. Until that lands, treat
run counts for SQL-assertion gates as a lower bound, and read a `never-attempted` verdict on
one of them as possibly meaning "this wording has never run" rather than "this gate has
never run".

### Where the data lives — and why this is not a laptop-only tool

Worth stating plainly, because the opposite is easy to assume:

- **Run *data* is remote.** `msbench-cli extract` is served by the backend — extracting an
  unknown id reports `Requesting run metadata from remote service`. **Any run id you have
  access to can be audited from any machine**, free and without tokens. The local
  `~/Library/Application Support/msbench/runs` directory is a cache, not the source.
- **Run *discovery* is local-only today.** With no arguments the tool can only enumerate
  this machine's cache. The CLI already supports `list runs --kusto --created_by
  --lookback`, which would make discovery team-wide, but the `MSBench User` role does not
  appear to grant Kusto DB read:

  ```
  Corp: Principal 'aaduser=…' is not authorized to read database 'ces_telemetry_prod'
   AME: Principal 'aaduser=…' is not authorized to read database 'msbench'
  ```

  (`ces-westus3-adx.westus3` and `msbdikustoprodeus2.eastus2` respectively.) That is a
  concrete, filable access gap and the entire fix for discovery.
- **Kusto could not answer this question even with access.** The ingested views —
  `CESBenchmarkInstanceStatusV2View`, `CESBenchmarkRunStatusV2View`,
  `CESBenchmarkMetricsDedupView`, `CESBenchmarkMetadataDedupView` — carry run and instance
  status, timings, tags, agent, model and resolved rate. **Per-assertion `details[]` is
  ingested nowhere.** Gate-level health is only computable from extracted artifacts.

The tool is therefore **run-id-driven and indifferent to provenance**. The day Kusto read
lands, `msbench-cli list runs --kusto` piped into `npm run gate-health` works with no
change to the tool. In CI the ids are known by construction anyway.

### Flags

| Flag | |
| --- | --- |
| `--extracted <dir>` | Audit an existing extraction; skips `msbench-cli` entirely. Repeatable. |
| `--min-runs <n>` | Runs required before a verdict counts as confident (default 3). |
| `--identity gate\|comment` | Gate identity scheme; see above. |
| `--refresh` | Re-extract even when the cache has the run. |
| `--json` | Machine-readable report, including the full declared-but-never-seen list. |

Extractions are cached in `.regrade/<run-id>`, shared with
[`regrade.ts`](#re-grading-a-past-run-for-free), so a run pulled by either tool is already
on disk for the other.

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

- The remaining two multi-turn stimuli (`plan-approval-scrapbook`,
  `plan-feedback-recipe-app`), following `plan-generation-task-app` — see
  [Multi-turn stimuli](#multi-turn-stimuli). Both reach the scaffold handoff, so both
  cost more of the chain than 1.5 does.
- LLM-as-judge assertions for the qualitative parts of a generated plan.
- Nightly CI once the CES identity is allowlisted; keep
  [`agent-contracts.yml`](../../.github/workflows/agent-contracts.yml) as the fast PR
  gate.
- Expand gates and graders, including browser assertions for the preview canvas.


Longer term these could graduate into `benchmarks/azure/` in
`vscode-copilot-evaluation`, alongside the GitHub Copilot for Azure team's deployment
scenarios (owner `fanyang-mono`). That buys a dedicated image and a richer starting
workspace, at the cost of a publish step — worth it once the set of stimuli is stable.
