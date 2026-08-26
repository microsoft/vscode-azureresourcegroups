# What the MSBench wiki says

We built our harness by reading MSBench source code. We later found the wiki — 58 pages,
checked into the `msbench` repo at `docs-site/source-wiki-pages/` on branch
`origin/andneil/docs-site-checkpoint`. This is what it says, where it contradicts what we
believed, and what we should do about it.

Companion to [`README.md`](README.md) (how to run) and `INVESTIGATION.md` (what we
established by experiment, PR #1703).

**Claim tags:** `[WIKI]` stated in the wiki · `[CODE]` read from source · `[VERIFIED]`
reproduced from our own run artifacts · `[INFERRED]` reasoned, not proven · `[UNKNOWN]`
open question · **the wiki does not address this** means exactly that — not "probably fine".

---

## The short version

| Question | Answer |
| --- | --- |
| Are our runs too big for the token quota? | **No — not close.** We use ~0.1% of it. |
| Then why did we get rate limited? | A **different limiter**, keyed on caller identity, not on tokens or on our integration. |
| Would Bring-Your-Own-CAPI fix it? | **Not as documented.** Only with one extra flag that must be explicitly requested. |
| Is it urgent? | **No.** Try run queueing first — it's free and targets the actual mechanism. |
| What's the real ceiling on a long run? | **Two hours of wall clock per instance**, not the 5 we configured. |

---

## 1. Rate limiting — settled

### 1.1 The token quota was never the problem

The number in the wiki is wrong, and so was our reading of our own data.

> "Unlocks higher CAPI **4.5M token limit** by using an HMAC key owned by the MSBench team,
> which bypasses per-user limits."
> — `published/Using-the-CES-CAPI-Proxy.md:7` `[WIKI]`

That 4.5M is `CopilotChat`'s **GPT-4o-mini** bucket in the unrelated `github` integration
group (`github/copilot-api`, `cmd/http/config/integrators.go:546-549`) `[CODE]`. It has
nothing to do with `autodev-test`. **Do not quote it.** The "capacity table" that bullet
links to (`Using-the-CES-CAPI-Proxy.md:117-153`) is a *model-capability* table — context
window, max prompt, max output — and contains no rate limit at all. **There is no
rate-limit table anywhere in the wiki**, and the MSBench team knows it: their own breakout
Q&A lists *"What are rate limits for different backends?"* as an anticipated question with
no scripted answer (`events/{-Breakout-2025‐11‐05-}-Outline.md:803`).

The real shape, from source `[CODE]`:

- **Unit and window:** tokens per minute, rolling 60 seconds.
  `integration_map.go:585-592` — `tpm()` sets `Window: time.Minute`, `CostIsAlways1: false`
  (*"this is the part that makes us count tokens, not requests"*). Not per hour, day, run,
  or instance.
- **Scope:** per model, per integration, *and* per enclosing group — both ceilings apply
  (`integrators.go:505-509`).
- **Our allocation:** `autodev-test` (`integrators.go:3091-3113`) gets
  **31,000,000 TPM for `claude-sonnet-4.5`** at both levels.

We measured ~676k tokens across 21 minutes — about **35k TPM, or 0.1% of the ceiling**.

> **A 1.76M–2.6M-token end-to-end run is not token-constrained.** The old "700k per 20
> minutes" budget was a misattribution. Stop sizing runs against it.

### 1.2 What actually threw the 429 `[VERIFIED]`

From our own stored artifacts —
`~/Library/Application Support/msbench/runs/2026082583236973`,
`output/vsc-output/capi-proxy.log:37-41`:

```
[9] POST /v1/messages -> 429
[9] Response headers: connection, content-type, date, server, retry-after, transfer-encoding,
    strict-transport-security, x-ms-middleware-request-id, request-context,
    content-security-policy, x-content-type-options, x-copilot-service-request-id,
    x-github-backend, x-github-request-id, x-github-edge-region
[9] Response body:
too many requests
```

Three things in that header list identify the source:

1. **`retry-after` present** — `send429` sets it (`pkg/rest/middleware/auth.go:716-718`).
2. **`x-ratelimit-exceeded` absent**, and no `X-Ratelimit-*-Retry-After`. The token-quota
   handler *unconditionally* adds both on every 429 it issues
   (`pkg/rest/ratelimit.go:143-152`). **This rules out the integration quota, the group
   quota, and every policy that flows through that handler.**
3. **`x-request-id` absent** — but present on all four surrounding 200s. The request was
   rejected in auth middleware, before the LLM pipeline assigned a request id.

The body `too many requests` appears in exactly one non-test file in `copilot-api`:
`send429`, on the **front-door** path.

### 1.3 The consequence: it is keyed on *who*, not *which integration*

```go
// pkg/actor/actor.go:267-283
func (a *ActorInfo) RateLimitID() string {
	prefix := ""
	if a.Type() == TypeOrg { prefix = "org:" }
	if a.ID != 0         { return prefix + strconv.FormatUint(a.ID, 10) }
	if a.Login != ""     { return prefix + a.Login }
	if a.TrackingID != ""{ return prefix + a.TrackingID }
	return prefix + "anonymous"
}
```

The integration id appears nowhere in the key (`auth.go:1009`) `[CODE]`. **Changing our
integration id would move which token buckets apply — the ones we don't need — and leave
the limiter that bit us untouched.**

What *does* turn it off is a single flag on the integration:

```go
// auth.go:620
if !integrationInfo.IgnoreGlobalUserChatLimit && actorInfo != nil && !checkedLimit && ...
```

`IgnoreGlobalUserChatLimit` appears 17 times in `integrators.go`; 16 set it `true`, and the
list is almost entirely offline-eval integrations — `VSCodeCopilotEvaluation`,
`CopilotPRReviewsEval`, `Coffe`, `nes-offline-eval`, `PosttrainingTeamVSCEval`,
`CodeAIEvals`, `MetisDev` and `MSFTRouterDev` (the last two with the comment
`// Allow parallel experiments`, which is exactly our failure mode). Of the 12 integrations
tagged `CategoryPreLaunchEvals`, **9 carry it**.

**`autodev-test` is `CategoryTier3` and carries none of the eval flags.** It is not
classified as an eval integration at all.

### 1.4 Open question — worth someone picking up `[UNKNOWN]`

Two things remain unresolved, and both are cheap to close:

- **Which of the two front-door limiters fired.** That path evaluates *both* a
  request-count limiter and token-based `GlobalUserLimits` (`rlpolicy.go:125-145` — 40M
  tokens / 5h per user), and **both emit identical responses**. So we cannot yet say
  whether the mitigation is fewer requests or fewer tokens. Do not re-plan around request
  shape until this is settled.
- **What our actor resolves to.** If server-to-server HMAC calls with no resolved user fall
  through to the literal `"anonymous"` branch above, then **every such caller of CAPI shares
  one bucket** — which would explain the erratic, volume-uncorrelated throttling in
  INVESTIGATION §2.2 better than the shared-`autodev-test`-allowance theory, and would mean
  the contention pool is far wider than we thought. **`[INFERRED]`, unproven, and the most
  valuable open question here.**

**How to close both, in order of cost:**

1. **Email `andneil@microsoft.com`** — he owns `autodev-test`
   (`integrators.go:3091`: `// slack: andneilmsft or andneil@microsoft.com`,
   `ContactEmails: ["andneil@microsoft.com"]`). One email likely answers both.
2. **Ask CES to log the `Retry-After` *value*.** It was on the response. Our proxy log
   records header *names* only and logs values for just `x-request-id` and
   `x-github-request-id`. A ~5-hour reset means the 5h per-user token limit; seconds means a
   short-window request limiter. Trivial change, diagnostic for every eval team —
   file at aka.ms/msbench/issues.

### 1.5 Nothing paces, retries, or backs off — except one thing we turned off by accident

> "When running multiple benchmark jobs in parallel, the agent can overrun its usage quota,
> causing rate limits. To prevent rate limiting, MSBench offers the ability to _queue_ runs
> which use the same model and endpoint. If you provide the `model` and `tags.endpoint`
> values in your YAML config, the runs will automatically be queued."
> — `published/Agent-Reference-Guide.md:259`, repeated at
> `published/2.-Quickstart-Working-with-Agents.md:345` `[WIKI]`

> "We do not enforce a specific spelling of the model name or endpoint, so please make sure
> you use exactly the same values as other members of your team, otherwise the runs will not
> be queued." `[WIKI]`

`run.sh` passes `--model .` and sets no `tags.endpoint`. **Every run we submit is unqueued
and races every other run, including our own.** This is the one documented anti-throttle
mechanism in the platform, it costs a few lines, and it targets *rate* — which is what
actually bit us. Corollary: avoid `--parallel_repeats`, which exists specifically to drop
the endpoint tag; prefer `--pass_at_k`, which preserves it as of 0.3.31.

Otherwise: `RATE_LIMIT` is an outcome code you self-report
(`published/Agent-Reference-Guide.md:185`), and a throttled instance is simply a failed
instance. Confirms INVESTIGATION §2.4.

---

## 2. The two-hour cap

> "**Long-running agents**: When running on MSBench supplied compute instances agents are
> limited to **two hours wall-clock time per test**. After two hours the agent will timeout
> and be killed. If your agent requires a lot of preprocessing, we recommend you do your
> preprocessing outside of MSBench and cache the results."
> — `published/1.-Quickstart-for-installing-and-running-MSBench-CLI.md:255` `[WIKI]`

This is phrased as a property of MSBench-supplied compute, not as a default. **"Per test"
means per instance**, and `published/Benchmark-Index.md:126` corroborates the distinction —
a 1600-instance MultiSweBench run is supported with *"up to 24 hours of execution time"*, so
run-level and instance-level ceilings are different numbers.

**`agentSeconds: 18000` in `config/base.yaml` is very likely fiction.**

### Why the schema doesn't save us

`TestConfig.schema.json` gives `agentSeconds` an effectively unbounded maximum, which looks
like permission. It isn't — the two govern different layers:

| | `agentSeconds` | The 2h cap |
| --- | --- | --- |
| Enforced by | the harness, **inside** the container | the platform, **outside** the container |
| Scope | *"Maximum time in seconds for the agent to complete **a chat command**"* | the whole instance |
| Default | 6300s (1.75h) — suspiciously just under 2h | — |
| Documented in | the schema (wiki never mentions it) | the wiki (schema never mentions it) |

**A config value cannot raise a platform cap.** If the platform kills at 2h, `agentSeconds`
never fires, `runnerGraceSeconds: 900` never runs, and nothing is flushed — precisely the
failure mode `base.yaml`'s own comment warns about, with a different number than we assumed.

Note also that the 6-hour GitHub Actions cap PR #1700 reasoned against **is documented
nowhere**. The only acknowledgement is `published/Advanced-Run-Options.md:1018` — *"MSBench
groups instances into batches due to GitHub Actions limits"* — with no number.

### We have never tested it `[VERIFIED]`

Across all 20 stored runs, **the longest is 49m28s** (`2026082579322454`); every other run
is under six minutes. We have never come within 2.5× of the cap, so we have neither
confirmation nor counter-evidence.

### The test that settles it

`published/Agent-Reference-Guide.md:183-184` gives the discriminator:
`AGENT_TIMEOUT` = *"Agent exceeded its soft wall-clock time limit"* (ours) vs
`CES_TIMEOUT` = *"Run was terminated by the MSBench execution service"* (theirs).

**One instance whose `script:` sleeps ~2h10m, then read `error.json`.** One cheap run
removes the largest unknown in the end-to-end design.

**Until then, plan against a 2-hour per-instance budget.** Don't revert #1700 — the values
are harmless if the cap is real and correct if it isn't — but update the comment block,
which currently derives 5h from an unverifiable 6h cap and cites no source. If 2h binds, a
single 7-stage chain in one chat session probably does not fit, and the chain has to split
across instances with state handed through the workspace — which is exactly what the
documented `instanceId` pattern (§4.1) is for.

---

## 3. Bring-Your-Own CAPI capacity — not urgent, and incomplete as documented

`published/Quickstart-for-using-the-VS-Code-Special-Agent.md:181-215` points at
`https://aka.ms/vscode-evals/byo-capi` →
`microsoft/vscode-copilot-evaluation/doc/internal/bring-your-own-capi/BYO_CAPI.md`.

**Read that page and the natural instinct is to follow it literally. Don't.**

**It would not have fixed our 429.** The two benchmark precedents it tells us to copy —
`azure-mcp-eval` (`copilot-integrations#692`) and `typescript-modernizer` (#688) — are both
in `integrators.go`, both landed as `Category: CategoryTier3`, and **neither carries
`IgnoreGlobalUserChatLimit`** `[CODE]`. Following the process as written yields an
integration configured exactly like `autodev-test`: a private token allocation we don't
need, and the same actor-keyed limiter we actually hit.

**It is also not triggered yet.** The wiki's own threshold is *"If your team will be doing
**routine** runs"* and *"large scale evaluations"*. A handful of mostly-manual runs a day is
neither.

**If we ever do it**, the ask must include, in the issue body: `Category:
CategoryPreLaunchEvals` and `IgnoreGlobalUserChatLimit: true`, citing `#717`, `#790`, `#850`
as precedent and quoting the `// Allow parallel experiments` comment — and saying plainly
that TPM is secondary. Ask for ~1M TPM per bucket (what `azure-mcp-eval` got); we use ~35k.

Sequence, briefly: GitHub **Dual Access** first (needs a sponsor inside GitHub; longest
pole, get two people), then the `onboarding.yaml` issue in `github/copilot-integrations`
(auto-assigned to `sharonlo` / `jbayhylle`); you receive an integration id and a 64-char
HMAC; store the HMAC in a **dedicated Corp** Key Vault — *"Assume that the agent will post
everything in this KV to an ATTACKER"* — granting `Key Vault Secrets User` to
`624eaabe-ca87-4607-80ac-28b5b0d6b76f` (Code Execution Service) and
`1c80e4a3-03be-421a-8d7f-a3d4e8837500` (MSBench AME Eval Runner). Config is a ten-line
change to `capiProxy:` in `base.yaml`. Wiki says *"a few weeks"*.

**It is not BYOK, and that distinction matters.** The quickstart treats them as separate
sections. BYO-CAPI keeps `modelSelector.vendor == 'copilot'` and
`baseUrl: https://api.githubcopilot.com/` — same models, same code path, **no fidelity
cost**. Every objection in INVESTIGATION §2.5 that made us pass on BYOK is inapplicable.

**A contradiction worth recording**, because it looks fatal and isn't:

> "The GitHub Copilot API (CAPI) CES Proxy currently works **only** with the integration id
> `autodev-test`. Other integration ids will not authenticate and requests will fail."
> — `published/Using-MSBench-Built-In-Agents.md:78` `[WIKI]`

That reads as a flat refutation of BYO-CAPI. **Resolution `[INFERRED]`:** they describe
different mechanisms. The CES proxy path posts to `ces-dev1.azurewebsites.net/api/copilot`;
the VS Code agent's `capiProxy:` block runs its own proxy against
`baseUrl: 'https://api.githubcopilot.com/'` — **direct to CAPI, bypassing the CES proxy and
its restriction**. BYO-CAPI works for us *because* we use the `vscode` special agent. Anyone
on the CES-proxy path genuinely is stuck on `autodev-test`.

**Unresolved risk `[UNKNOWN]`:** `BYO_CAPI.md:10` (written 2025-12-15) says *"On January 5th,
we will be cutting teams off from the VS Code Team's own capacity."* That date passed and we
still run, which suggests it targeted `VSCodeCopilotEvaluation` rather than `autodev-test`
— those are distinct integrations in `integrators.go`. **No wiki page confirms or refutes
this.** A similar cull of `autodev-test` would stop our harness overnight and we have no
notice channel for it.

---

## 4. What we're doing right, and what we're doing the hard way

### 4.1 Right — and better-supported than we thought

**Our multi-instance dispatcher is the documented design, not a hack.**

> "You may have a benchmark where a single image could support many different
> tests/instances. **This is common in chat scenarios**, where the actual files within a
> container are not different, but the tests differ just by a string or environment
> variable… Each container receives an environment variable called `instanceId`, which can
> be used to select different test cases or set up files accordingly."
> — `published/4.-Adding-a-benchmark.md:490-500` `[WIKI]`

Detection works exactly as we reverse-engineered: if `instance_id` isn't in `image_tag`, it
arrives via `instanceId`. Caveat at `:492` — *"This is preview functionality and is not yet
supported at the same level as regular benchmarks."*

Also correct: `--model .` (*"you SHOULD always use `--model .` when running the `vscode`
agent"*, `Quickstart-for-using-the-VS-Code-Special-Agent.md:57`); custom VSIX via
`installExtensions … mode: vsix` (`:106-120`, and `.vsix` files are discovered
**recursively** in the assets dir); `user-overrides.yaml` itself, which is first-class and
documented (`:15`, `:28`).

**Graders cannot change the verdict — our reading was right.**

> "Benchmarks define WHAT the outcome was for a given task: they set pass/fail criteria…
> Grading is the process of evaluating HOW an agent approached that task-instance regardless
> of pass/fail outcome."
> — `published/6.-Grading-your-run-using-custom-graders.md:1-3` `[WIKI]`

The proposed spec goes further (`{-Proposed-}-MSBench-Grading-System.md:960-964`): agent
outputs are checksummed before grading, files created outside `graders/` are removed, and
modifications are logged. **A grader cannot change `resolved` even if it tries.** Grading is
a reporting layer; it surfaces on the Instance Scores tab and in `CESBenchmarkGradingTable`.

**`--merge-compat subset` is the correct call** for partial re-runs
(`published/Merging-Runs.md:161-175`).

### 4.2 The hard way

**Borrowing `say_hello`.** `user-overrides.yaml` is sanctioned; **the three-layer merge, the
precedence rules, and `run-agent.sh`'s config re-read order are documented nowhere**, and
borrowing another benchmark's image to run entirely different work is not a described
pattern — not forbidden, just absent. It rests on internals that can change without notice.

**The supported equivalent is cheap and needs nobody's permission:**

> "Private benchmark — Keep the dataset file (`dataset.jsonl` / `.csv`) in your own repo or
> anywhere on disk. When you run `msbench-cli`, pass `--dataset /path/to/dataset.jsonl`…
> **No PR to `msbench-benchmarks` is required.**"
> — `published/5.-Bring-Your-Own-Benchmark-Repository.md` `[WIKI]`

> "This is also the permanent workflow if you want to keep your benchmark private — there is
> no need to ever open a PR." `[WIKI]`

**Flags we should be using but aren't:**

- **`--events <file.jsonl>`** — machine-readable event stream. Use for nightly CI instead of
  scraping console output.
- **`MSBENCH_NO_SPINNER=1`, `MSBENCH_PLAIN_CONSOLE=1`** — CI-clean output.
- **Status-selector reruns** — `--benchmark run_<id>.json:error,missing`
  (`resolved` / `unresolved` / `error` / `missing` / `failed`). `extract` takes the same
  syntax.
- **`--pass_at_k K`** — unbiased Pass@K; better than `--repeat` for a non-deterministic
  chain, and it keeps the endpoint tag.
- **`--tag`** + **`list_runs --similar-to <run_id>`** (0.3.35) — night-over-night regression
  detection.
- **`report --view analysis`** and **`msbench-cli assist "…"`** — AI triage; cheaper than
  re-running to debug. `MSBENCH_DISABLE_RUN_ANALYSIS=1` to silence in CI.
- **`MSBENCH_SPECIAL_AGENT_PACKAGE`** — test a local build of the VS Code agent without
  publishing to the feed.

⚠️ **`--timeout` discrepancy.** The breakout CLI reference lists the default as **7200,
"per instance"**; our INVESTIGATION has it as a purely local wait that cancels the CES run
on expiry — which matches the 0.3.21 release note (*"`--timeout` now properly cancels CES
runs and downloads partial results"*). **The two disagree; ours is better-evidenced. Keep
leaving it unset.**

---

## 5. Two things nobody thought to ask

### 5.1 Our ~40% blob loss is a known, deterministic bug — not bad luck

From the `msbench` repo (`.github/agents/msbench-reliability-reports.agent.md:1173-1181`) —
**not the wiki** `[CODE]`:

> The ingestor "reads each GH Actions artifact **fully into memory** … and rejects anything
> over a **1 GiB** cap. An output.zip > 1 GiB fails **deterministically every retry**, so
> after `MaxDequeueCount = 5` the message is moved to `artifact-ingestion-poison` and that
> artifact is **never** reconciled into blob storage (reads as a missing blob)."

**Our runs record screen recordings, trajectories and `session.sqlite` over long sessions.
We are a prime candidate to breach 1 GiB** — and it gets worse as runs get longer, which is
exactly the direction we're heading. A second documented cause of inflated "missing" counts:
*"A sibling matrix instance failed and `fail-fast` cancelled otherwise-healthy legs."*

**Action:** check `output.zip` sizes before blaming CES; cap or drop screen recording for
long runs.

### 5.2 A smoke test silently burns one instance per multi-instance run

`proposed/{-Proposed-}Smoke-Tests.md`: MSBench takes the first requested instance in batch 1
and runs it with the real image and wiring before fanning out. **That is real tokens and a
real slot we have not been accounting for.** `MSBENCH_DISABLE_SMOKE_TEST=1` disables it.

### 5.3 Also worth knowing

- **Multi-turn evaluation has no first-class support.** No `promptSteps`, no turn
  orchestration, no checkpointing anywhere in the wiki. MSBench's model is one container →
  one agent invocation → run to completion. ATIF *records* multi-turn (*"Each step
  represents a single interaction turn"*) but nothing *drives* it. **Our entire scenario
  shape sits outside what the platform documents** — worth stating in any plan, especially
  alongside the 2h cap.
- **ATIF trajectories must be written by the agent** to
  `$OUTPUT_DIR/trajectories/trajectory.json`; MSBench does not generate them. If our agent
  emits ATIF we get the trajectory viewer, tool-usage charts, the Kusto Trajectories table,
  and **per-step cached-token accounting** — which is precisely the instrumentation §1.4
  needs. Worth confirming what our runs actually emit. `continued_trajectory_ref` exists for
  splitting a session across files, the natural fit if we split the chain across instances.
- **Offline re-grading is not documented at all** — no `regrade` command, no documented way
  to run graders against stored artifacts. We built `regrade.ts` (#1704) ourselves, and as
  far as the wiki is concerned that capability doesn't exist. Worth telling the MSBench team
  about.
- **The `proposed/` pages are a docs rewrite, not a v2 CLI.** We are not building against a
  soon-to-be-legacy interface. Only cosmetic drift: `list <noun>` is superseding
  `list_benchmarks` / `list_instances`.

---

## 6. Known and available — not needed yet

Findable later without re-deriving. All `[WIKI]`.

| Topic | What the wiki says | Where |
| --- | --- | --- |
| **Own image, private** | No PR, no approval. Keep everything in our repo; `--dataset` (JSONL/CSV/Parquet) or `BENCHMARK_DATASET_PATH`. *"You don't need to wait for your PR to be merged to test your benchmark."* | `5.-Bring-Your-Own-Benchmark-Repository.md` |
| **Own image, public** | Two PRs — `msbench-benchmarks` (`benchmark_loaders.toml` + dataset) and `MicrosoftSweBench` (metrics parser). Gates: fresh-clone `generate_database`, `buggy_validation` all-unresolved, `fix_validation` all-resolved. **No approver named.** Adding benchmarks is *"in the private preview stage."* | `4.-Adding-a-benchmark.md:222,281-283,35` |
| **CES image contract** | Debian/Ubuntu `linux/amd64`, `apt-get`, `--privileged` + `--runtime=sysbox-runc`, tolerate `tail -f /dev/null`. Needs `/agent`, `/agent/runner.sh`, `/ces_activate.sh`, `/entry.sh`, `/drop/metadata.json`, `/output`, `/save.sh`, `/restore.sh`. Tag `<benchmark>.eval.x86_64.<instance_id>:msbench-<version>`, **<85 chars** or the site loses live status and run duration. **Size limits: not addressed.** | `Adding-a-benchmark ‐ Expectations…`, `4.-Adding-a-benchmark.md:309-323` |
| **Bring your own ACR** | **Fully self-serve, no MSBench approval.** Set ACR to *RBAC Registry Permissions* (not the ABAC variant); grant `AcrPull` to CES (Corp SP `f5f1c93c-…` / obj `624eaabe-…`). Per-instance `container_registry`; one run can mix registries. ⚠️ *"`container_registry` must also be included in the `benchmark_columns` field of each row. If it is missing, MSBench will silently fall back to `codeexecservice.azurecr.io`."* Azure registries only. | `Bring-Your-Own-Azure-Container-Registry.md` |
| **The `azure` benchmark** | **The wiki never mentions it.** Owner confirmed from source instead: `AzureMCPEval` → `DRIs: ["@fanyang-mono"]`, `yangfan@microsoft.com`, issue #692. **No documented path for joining another team's benchmark** — the wiki warns namespaces collide. | `integrators.go:4266-4268` `[CODE]` |
| **Grader framework** | `msbench-sdk` + `ToolGrader`, `grader.manifest.json`, `grader.schema.json` with declarative thresholds; `msbench-cli grader validate\|list`; attach via `--graders x.zip`. SDK **auto-vendored — no pip install in-container**. `ChatClient` gives LLM graders via managed identity. **Exit codes: the wiki defines none** — our 0/1/3 convention has no counterpart. `custom_metrics.json` is explicitly legacy. | `6.-Grading-your-run-using-custom-graders.md` |
| **Grader containers** ⚠️ | Instance graders run **inside the benchmark container** (`docker exec`); run-level graders run **on the GitHub Actions runner** — different environments. Node 22 exists in CES benchmark containers via `. /opt/activate_node.sh`, but **the grading docs never state it is sourced before `entry.sh` runs**, and every example is `python3`. **Whether `node` is on PATH for graders is undocumented** — a blocker for our TypeScript validators, settled by one probe. Same class as our `pip=MISSING` finding, and note these are *different containers*. | `6.-…custom-graders.md:17-18,66-68,93` |
| **Merge strategies** | `best_resolved`, `first_valid`, `basic`, `pass_at_k`, all-attempts (0.3.28). `--merge-compat strict\|subset\|union`. **Merging runs with missing artifacts: not addressed.** | `Merging-Runs.md`, `Merge-Strategies.md` |
| **GitHub Actions** | Allowlisting **is** required: *"Send the Client ID of the new identity to the MSBench/CES team at msbench@microsoft.com. This will take 1-2 days."* Then federated credential, secrets `AZURE_CLIENT_ID`/`AZURE_TENANT_ID`/`AZURE_SUBSCRIPTION_ID`, `permissions: id-token: write`, `azure/login@v2`. ⚠️ The sample contains `$(Build.ArtifactStagingDirectory)` — an Azure Pipelines variable, unflagged copy-paste error. **Azure Pipelines is better documented.** **Nightly CI: not addressed.** | `Submitting-MSBench-runs-from-GitHub-Actions.md` |
| **Runtimes** | CES executes everything. Four architectures: Standard Linux Container (ours), CCA, Windows Container (`ces-staging`/`ces-dev1` only, **not AME**), Windows Hill Climbing. | `Runtime-Architectures.md` |
| **AME** | **Stay on `ces-dev1`.** `vscbench` shows AME *"⌛ Not supported yet"*; *"Runs executed in the corp compute environment are not ingested to the AME site"* — separate cluster, separate site, **no history carries over**. Access needs tenting + Andrew Neil. Large benchmarks >600 images ❌, Windows VM ❌. | `Eval-Feature-Support-in-AME.md`, `Benchmark-Index.md:25`, `MSBench-AME-Environment ‐ Dogfooding-Guide.md` |
| **Access** | Request the **`MSBench User`** role at CoreIdentity entitlement `msbenchacces-azh0`; manager approval, syncs <1h. Grants ADO feed, repo push, `codeexecservice` ACR pull **and push**, and Kusto. `--kusto` needs *"Corpnet/Azure VPN … or a Dev Box."* **Compute quotas, concurrency limits, cost, artifact retention: none addressed.** | `0.-Gaining-Access.md` |

---

## 7. Contacts

| Who | For what |
| --- | --- |
| **andneil@microsoft.com** (Slack `andneilmsft`) | Owner of `autodev-test` (`integrators.go:3091`). The limiter questions in §1.4, quota changes, and AME access. **Start here.** |
| **@fanyang-mono** / **yangfan@microsoft.com** | The `azure` benchmark and `azure-mcp-eval` (`copilot-integrations#692`). |
| **msbench@microsoft.com** | CI identity allowlisting (1–2 days). Independent of everything else — file early. |
| **aka.ms/msbench/issues** | Bugs. Worth filing: log the `Retry-After` *value* in the CAPI proxy log. |
| Office Hours, Wed 10:05–10:30 PT | The wiki's own suggested venue for rate-limit questions it doesn't answer. |
| `sharonlo`, `jbayhylle` | Auto-assignees on the `github/copilot-integrations` onboarding template — only if BYO-CAPI is ever triggered. |

---

## 8. What to do, ranked

1. **Turn on run queueing** — `model:` + `tags.endpoint:`, spellings agreed team-wide. The
   only documented anti-throttle mechanism; we're opted out by omission; it targets the rate
   that actually bit us. Free. Measure after.
2. **Prove or disprove the 2h cap** with one deliberate long no-op run, and plan the
   end-to-end chain against 2 hours per instance until then. Update `base.yaml`'s comment
   block.
3. **Move to our own `dataset.jsonl` + `--dataset`.** Documented, no PR, no approval, and it
   removes our dependence on `run-agent.sh`'s undocumented ordering. Biggest reduction in
   unsupported surface for the least work.
4. **Probe two container facts** before designing around them: is `node` on PATH in the
   grading container, and does `TESTBED_DIR` reach the agent's workspace for `vscbench`?
   One line each; both gate the grader migration.
5. **Adopt `--events` and the CI env toggles** before writing nightly CI against console
   scraping. File the msbench@ allowlist request in parallel.
6. **Check `output.zip` sizes against the 1 GiB ingestion cap** (§5.1) before attributing
   any further artifact loss to CES.
7. **Migrate graders to `ToolGrader` + `grader.schema.json`** — once §4 settles whether Node
   is available.
8. **BYO-CAPI — hold.** Only if queueing doesn't fix throttling, and only with
   `IgnoreGlobalUserChatLimit` in the ask.
