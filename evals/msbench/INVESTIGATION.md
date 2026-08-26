# MSBench investigation — findings, evidence, and traps

A durable record of a spike into what MSBench can and cannot do for the Copilot-on-Rails
eval suite. [`README.md`](README.md) tells you how to *run* the suite as it exists today;
this file explains what we learned about the platform underneath it, so the expensive
discoveries do not have to be made twice.

Several findings here **corrected confident wrong assumptions**. Those are called out
inline, because the wrong version is usually the intuitive one.

## How to read this

Every load-bearing claim is tagged:

| Tag | Meaning |
| --- | --- |
| **[VERIFIED]** | Observed by running something, or read out of a real run's artifacts. Run IDs given. |
| **[CODE]** | Read directly from source, with file and line. Reliable, but not exercised. |
| **[INFERRED]** | Reasoned from evidence. Could be wrong. |
| **[UNKNOWN]** | Genuinely not established. Do not guess. |

Line numbers refer to `msbench-cli` **0.3.54** / `msbench-agent-vscode` **0.0.22** (in
`~/.msbench-venv/lib/python3.12/site-packages/`), and to `microsoft/vscode-copilot-evaluation`
as of 2026-08-25. They will drift; the surrounding function names are the durable part.

---

## 1. Many scenarios in one run: `--dataset` + the `$instanceId` dispatcher

**The problem.** `scripts/run-agent.sh` does a literal `cp "$PWD/user-overrides.yaml"`
(line 172), so exactly one config file exists per run. One config means one `promptSteps`
and one assertion set — hence today's one-run-per-stimulus design
([README](README.md#why-one-config-file-per-stimulus)). Wanting N stacks with their own
prompts *and* their own assertions in a single run looks impossible.

**It is possible.** One run can carry N scenarios with distinct prompts and distinct
assertions, with **no new benchmark instance, no published image, and no PR into the
eval repo** — preserving the property that makes this whole approach cheap.

### 1.1 What `--dataset` actually overrides

The **instance catalogue only**. A row needs just three fields — `benchmark`,
`instance_id`, `image_tag` — and validation is close to nil (ASCII-only on the two
identifiers). **[CODE]** `BenchmarkInstance`, `benchmark_db/benchmark_database.py:98-125`;
`benchmark_identifiers.py:11-32`; loader (parquet / csv / jsonl) at
`benchmark_database.py:826-891`.

> **Trap.** The model is `ConfigDict(extra="allow")` (`:125`), so **extra columns are
> silently accepted and then silently dropped**. `_format_jsonl_line` (`:260-329`) emits
> only `image_tag`, `instance_id`, `container_registry`, the `task_*` fields and BYOC
> compute fields. A `prompt` or `assertions` column will validate and never reach the
> container. Dataset rows cannot carry scenario content.

`--dataset` as a *global* flag before the subcommand did not take effect for `list`;
the `BENCHMARK_DATASET_PATH` env var did. **[VERIFIED]** Prefer the env var.

### 1.2 One borrowed image, N instances

`instance_id` may differ from the id encoded in `image_tag`. When it does, the CLI emits
it explicitly so CES can pass it to the container dynamically. **[CODE]**
`benchmark_database.py:230-234` and `:271-277`; `uses_dynamic_instance_id` at `:366-368`;
consumed at `execution/ces_client.py:1062-1068`. `execution/docker_client.py:332-333` says
it outright: *"If the instance_id is not part of the image tag, we are in a 1 image ->
many instances scenario."*

A three-row dataset borrowing `vscbench.say_hello` produces exactly this **[VERIFIED]**.
The benchmark name is arbitrary and is yours to choose — this document quotes two real
ones from two different probes, `corbench` here and `cormodel` in §4.1/§5.2, and the
commands are reproduced verbatim from the runs that produced them rather than unified
after the fact:

```jsonl
{"benchmark":"corbench","instance_id":"react_functions_postgres","image_tag":"vscbench.eval.x86_64.say_hello:msbench-7.0.0"}
{"benchmark":"corbench","instance_id":"python_fastapi_cosmos","image_tag":"vscbench.eval.x86_64.say_hello:msbench-7.0.0"}
{"benchmark":"corbench","instance_id":"csharp_functions_sql","image_tag":"vscbench.eval.x86_64.say_hello:msbench-7.0.0"}
```

What CES then receives, in `run_config.jsonl`:

```jsonl
{"image_tag":"vscbench.eval.x86_64.say_hello:msbench-7.0.0","instance_id":"react_functions_postgres"}
{"image_tag":"vscbench.eval.x86_64.say_hello:msbench-7.0.0","instance_id":"python_fastapi_cosmos"}
{"image_tag":"vscbench.eval.x86_64.say_hello:msbench-7.0.0","instance_id":"csharp_functions_sql"}
```

### 1.3 `INSTANCE_ID` is the wrong variable — use `$instanceId`

This one cost a probe run to discover and is the single most important detail in this
document.

**`INSTANCE_ID` (upper snake) is derived from the image tag and is identical in every
container.** The dynamic id from the dataset arrives as **`instanceId` (lower camel)**.
**[VERIFIED]** — run `2026082601666109`, two instances on one image, from each one's
`output/vsc-output/customScript/output.log`:

```
probe_alpha: INSTANCE_ID=[say_hello]   instanceId=[probe_alpha]   EVAL_INSTANCE_ID=[say_hello]
probe_beta : INSTANCE_ID=[say_hello]   instanceId=[probe_beta]    EVAL_INSTANCE_ID=[say_hello]
```

`EVAL_INSTANCE_ID` is derived from `INSTANCE_ID` (`run-agent.sh:130`) and is equally
useless for this. `runId` is present and correct; `MSBENCH_INSTANCE_CORRELATION_ID` is
distinct per job but opaque. The lower-camel spelling matches the local Docker backend
(`docker_client.py:159`) and BYOC, which calls it a "compatibility alias"
(`byoc_client.py:612`).

Result plumbing is unaffected either way — MSBench keys results by CES job identity, and
the two instances produced correctly-named, separate output directories.

### 1.4 The ordering dependency that makes it work

`run-agent.sh` reads `$USER_OVERRIDES_PATH` from disk **three times, in three separate
processes**:

| Line | What happens |
| --- | --- |
| 172 | the single `user-overrides.yaml` is copied to `$USER_OVERRIDES_PATH` |
| 237 | `vsc-eval cat-script … --config-path $USER_OVERRIDES_PATH` extracts `script:` |
| 246 | `bash "$CUSTOM_SCRIPT_PATH"` runs it, with `$instanceId` in the environment |
| 291/353 | `vsc-eval agent … --config-path $USER_OVERRIDES_PATH` — **re-reads the file** |
| 504 | `vsc-eval assertions assert … --config-path $USER_OVERRIDES_PATH` — **re-reads it again** |

So a dispatcher `script:` — identical in every instance, branching on `$instanceId` — can
replace the config *after* it has been read for the script but *before* it is read for the
prompt and the assertions. **This is a behavioural dependency on upstream ordering, not a
supported extension point.** If a future `run-agent.sh` parses the config once and reuses
it, the mechanism breaks silently. Treat it as something to re-verify on upstream bumps.

> **Scope of that fragility — most of this approach is sanctioned, not improvised.**
> `published/Quickstart-for-using-the-VS-Code-Special-Agent.md` prescribes exactly the
> `--agent-assets` + `user-overrides.yaml` + `installExtensions: mode: vsix` shape we use,
> hardcoded container path included. So the borrowed image, the asset staging and the VSIX
> install are the documented happy path. **Only the `$instanceId` dispatcher in this
> section is genuinely ours, and it is the only part carrying upstream-coupling risk.**

The whole `--agent-assets` tree ships verbatim into the container **[VERIFIED]** (staged
at `…/agent/package/assets`, reachable as `/agent/assets`), so `assets/stimuli/<id>.yaml`
files arrive intact. Only `user-overrides.yaml` and `*.vsix` get copied out to
`$WORKTREE` (`runner_rendering/common.py:190-205`); everything else stays readable at
`$ASSETS_DIR`.

### 1.5 Proven end to end

Run `2026082602313040`, 2 instances, **100% resolved, 65,023 tokens**. Three independent
channels agree **[VERIFIED]**:

1. `PROBE_DISPATCH=SELECTED:probe_alpha` / `SELECTED:probe_beta`.
2. `diff` of the two `output/vsc-output/configs/msbench-user-overrides.yaml` — the
   *effective* configs differ in both `promptSteps.text` **and** the assertion set.
3. Different artifacts: `probe_alpha` produced `ALPHA.txt`, `probe_beta` produced
   `BETA.txt`, each asserting its own file exists *and* the other's does not.

Channel 2 matters most: assertions can pass for the wrong reason, but two materially
different effective configs cannot.

### 1.6 Two requirements that are not optional

**Every per-instance file must be self-contained.** The dispatcher replaces the config
wholesale, so each stimulus file must carry `capiProxy`, `modelSelector`,
`dangerouslyAutoApproveAllToolCalls`, `installExtensions`, `chatMode` — everything the run
needs. Anything omitted is simply gone.

This is safe *because* of how `--model .` works: with both `capiProxy` and `modelSelector`
present, the runner copies the asset file **byte for byte** with no appends **[VERIFIED]**
(runner notes: *"capiProxy set in user-overrides.yaml; preserving value"*, *"modelSelector
set in user-overrides.yaml; using it because --model . was supplied"*). See §4.3 for why
a real `--model X` breaks this.

**The dispatcher must hard-fail when no stimulus matches.** Falling through to a default
is the dangerous failure mode: every instance would quietly run the same scenario and the
suite would look green while testing one stack N times. That is the "confidently wrong"
class again. Fail loudly:

```bash
script: |
  set -u
  ASSETS="${MSBENCH_SPECIAL_AGENT_ASSETS_DIR:-${AGENT_ASSETS:-${AGENT_DIR:-/agent}/assets}}"
  TARGET="$(vsc-eval assets writeable-path msBenchUserOverridesConfig --output-dir "$OUTPUT_DIR")"
  SELECTOR="${instanceId:-}"          # NOT $INSTANCE_ID — see 1.3
  CANDIDATE="$ASSETS/stimuli/${SELECTOR}.yaml"
  if [ -z "$SELECTOR" ] || [ ! -f "$CANDIDATE" ]; then
      echo "FATAL: no stimulus for instanceId=[${SELECTOR}]"
      ls -1 "$ASSETS/stimuli" 2>&1
      exit 1
  fi
  cp "$CANDIDATE" "$TARGET"
  echo "DISPATCH=SELECTED:${SELECTOR}"
```

Deliberately **not** `set -e` before the diagnostics: a non-zero exit aborts the run with
`X_CUSTOM_SCRIPT_FAILURE` before anything is recorded. Artifacts *do* survive a
script-phase failure **[VERIFIED]**, so echo the evidence first, then exit.

### 1.7 What this deletes, and what it does not buy

Deletes: per-scenario submission and its aggregation layer (one run, one report),
build-time config selection, and hand-rolled pass@k. Native equivalents: `--workers`,
`--repeat`, `merge --strategy pass_at_k`, `report --view pass-at-k`.

**Throughput is bounded by a shared limiter, not by MSBench.** See §2.3 and §2.4 — every
instance funnels through the same `autodev-test` integration and the same per-user
limiter, so N instances in parallel consume that shared budget N times faster. Since the
binding constraint appears to be **request rate** rather than token volume (§2.3),
concurrency is still worth using — just not assumed free. The primary value of
multi-instance remains a single combined report and one submission.

---

## 2. Rate limiting

### 2.1 The 429 is scoped to an API surface, not to the integration

**The most consequential finding of the spike.** From the throttled run's own
`output/vsc-output/capi-proxy.log` **[VERIFIED]** (run `2026082583236973`):

```
23:11:12.786  [8]  POST /v1/messages      -> 200
23:11:14.772  [9]  POST /v1/messages      -> 429     <-- Claude throttled
23:11:14.773  [9]  Response body: too many requests
23:11:15.438  [10] POST /chat/completions -> 200     <-- 666 ms later, SUCCEEDS
```

666 milliseconds after Claude was refused, an OpenAI-surface call succeeded — **same
container, same run, same credential, same `autodev-test` integration**. A single global
bucket cannot produce that.

Path census across four runs **[VERIFIED]**:

| Run | model | `/chat/completions` | `/v1/messages` | `/responses` | `/embeddings` |
| --- | --- | --- | --- | --- | --- |
| `2026082579322454` | claude-sonnet-4.5 | 9 × 200 | 5 × 200 | — | 2 × 200 |
| `2026082583236973` | claude-sonnet-4.5 | 6 × 200 | 2 × 200, **1 × 429** | — | — |
| `2026082603685803` | gpt-4.1 | 5 × 200 | **0** | — | — |
| `2026082604036532` | gpt-5.6-sol / gpt-5-mini | 4 × 200 | **0** | 1 × 200 | — |

`/v1/messages` is the Anthropic Messages API and carries Claude's traffic. **A GPT run
touches it zero times** — no helper model, fallback, summariser or embedding call leaks
onto the contended surface. Note that newer GPT models add `/responses` (OpenAI Responses
API), so **any 429 check must match all paths, not just `/chat/completions`.**

This corroborates the Copilot Model Factory report of rate limiting specifically affecting
*Claude* models.

> **What this does and does not establish.** The observation is verified: something
> refused `/v1/messages` while letting `/chat/completions` through, within the same second
> and on the same credential. Whatever the limiter is, its scope is **narrower than "the
> integration"**. It does *not* establish that each surface has its own token bucket — see
> §2.3, where the leading explanation is a request-count limiter that does not obviously
> account for this split. Treat "switching models moves us off the contended path" as
> supported; treat any specific per-surface budget as **[UNKNOWN]**.

### 2.2 The allowance is shared — possibly with other teams

Every run presents the same CAPI integration, `autodev-test`. **[CODE]**
`DEFAULT_MSBENCH_INDEX_INTEGRATION_ID` at `models/models_map_utils.py:23`;
`copilotIntegrationId` is a *run-level* submission parameter that CES defaults to
`autodev-test` when absent (`execution/ces_client.py:896-904`); our runs record
`ces_proxy_integration_id=None`. `msbench-cli list indexes` returns exactly one index
available to us. **[VERIFIED]** the proxy log prints `Integration ID: autodev-test`.

**The same id is hard-coded by other teams** — `github/triage-agent`
(`evals/runner/github-copilot-coding-agent_models.yaml`) and MSBench's own Vally grader
runtime (`src/msbench-graders/vally/README.md:115`) both export
`GITHUB_COPILOT_INTEGRATION_ID=autodev-test`.

> **Interpret erratic throttling accordingly.** A RATE_LIMIT is **not** necessarily a
> signal about your own recent activity. You may simply have arrived while another team
> was consuming the shared allowance. Do not reason backwards from a throttle to "I ran
> too much".

Good news on the other side: evals do **not** consume anyone's personal Copilot seat. The
proxy authenticates server-side — `CAPI proxy handles auth server-side; skipping local
Copilot sign-in` **[VERIFIED]** — and `signIntoCopilot` is forced to `false` for every
agent run regardless of config (**[CODE]** `src/vsCodeApplication.ts:709-715`: *"retained
in the config schema for back-compat but is no longer honored"*). The `az` token minted by
`run.sh` is only for the CES control plane and the ADO feed; there is **no Copilot
credential in the container environment at all** **[VERIFIED]**.

### 2.3 What the 429 was — and what our token measurements did *not* measure

> **This section originally concluded that the limiter meters total tokens against a
> ~650k–720k budget. That conclusion was wrong.** It is rewritten rather than deleted,
> because the observation underneath it was real and the way it misled is instructive.

#### The integration quota is TPM, and we are nowhere near it

The `autodev-test` integration is allocated **31,000,000 tokens per minute** for
`claude-sonnet-4.5`, metered over a 60-second sliding window, and the enclosing `github`
group limit is identical — so 31M TPM is the shared ceiling across every consumer.
**[CODE]** `github/copilot-api`: `cmd/http/config/integrators.go:3091-3113`,
window semantics at `integration_map.go:585-592`.

**Our observed peak was ~676k tokens across ~21 minutes ≈ 35k TPM — roughly 0.1% of that
ceiling.** We were never remotely close to the integration quota, and the 429 we saw did
not come from it.

> **Do not quote a "4.5M token limit".** That figure belongs to the `CopilotChat`
> integration's **GPT-4o-mini** bucket (`integrators.go:546-549`) — a different
> integration, a different model, and not a total. The wiki page stating it
> (`published/Using-the-CES-CAPI-Proxy.md:7`) is stale; the "Supported Models & Capacity"
> table it links to contains no rate limits at all, only per-request context windows.

#### Leading hypothesis: a per-user *request-count* limiter

The proxy logged the 429 body as exactly `too many requests` **[VERIFIED]**. In
`copilot-api` that string is produced in exactly one place — `send429` at
`pkg/rest/middleware/auth.go:718` — reachable only from **`FrontDoorLimiter`**, described
in its own doc comment (`:721-725`) as *"a per-user ratelimiter that puts a ceiling on
number of API requests a user may make against CAPI."* **[CODE]**

Corroboration from our own artifacts **[VERIFIED]**: `send429` sets a `Retry-After`
header, and in the throttled run's `capi-proxy.log` a `retry-after` header appears on
**exactly one response — the 429** — and on no successful response. (The proxy logs header
*names* only, so the value is **[UNKNOWN]**.)

**This is not yet fully confirmed** — it comes from reading `copilot-api` source, the same
method that produced the claims this section replaces.

#### Why that inverts the mitigation

If the binding limiter counts **requests**, then the fix is **fewer, larger requests — not
fewer tokens.** That is the opposite of what a token budget would imply, and it changes
what "expensive" means: a long agent session is costly because it makes many turns, not
because it moves many tokens.

#### An unresolved tension, stated plainly

A per-user request-count limiter does not obviously explain §2.1, where a
`/chat/completions` call succeeded **666 ms after** a `/v1/messages` call was refused, in
the same container on the same credential. Under a pure per-user request ceiling, a
request is a request and both should have been refused.

So either the limiter is keyed on something finer than user alone (user + endpoint, or
user + model family), or the 429 came from a different limiter than `FrontDoorLimiter`, or
the surviving call was already in flight. **[UNKNOWN]** — the §2.1 observation is verified
and stands on its own; what remains unsettled is the mechanism behind it. Do not let a
tidy explanation overwrite a measurement that does not fit it.

#### The original observation, demoted

The two windows **[VERIFIED]** (true times via `show_run`, not the `list runs` column —
that shows local-DB write time and is misleading):

| window | wall clock | runs | total tokens | uncached tokens | outcome |
| --- | --- | --- | --- | --- | --- |
| 15:51 → 16:12 | 21 min | 3 | 676,020 (723,164 at the moment of failure) | 68,712 (82,349) | 4th run **throttled** |
| 16:34 → 17:01 | 27 min | 3 | 609,552 | 67,558 | no throttle |

The observation is sound: the uncached sums are within 1.7% of each other while the totals
differ by ~11%. The *inference* — that this proves the meter counts total tokens — is
**[INFERRED]** and **probably coincidental**. Both quantities were compared against a
limiter that, on current evidence, was counting neither: request counts would also have
differed between those two windows, and nothing was measured that could distinguish them.

**The lesson worth keeping: a discriminator is only as good as the assumption that the
mechanism is one of the two things you compared.** Both candidates here were token
volumes; the actual limiter appears not to be about token volume at all.

### 2.4 Nothing paces, retries, or backs off

- **In the agent, a rate limit is terminal.** `_killRun.error(new AgentApplicationRateLimit(...))`
  and `throw new AgentApplicationRateLimit('API', …)` **[CODE]**
  `src/vsCodeApplication.ts:1601-1603` and `:3342-3343`. The method is named `_killRun`.
- **It fires mid-session, not between runs.** The throttled run died at step 2 with the
  stack at `_executeChatCommand` → `_runAgentLoop` **[VERIFIED]**. There is no
  checkpointing, so the work already done is lost (see §5).
- **In the CLI**, every 429/back-off path in `execution/ces_client.py` (`:229`, `:1951`,
  `:2049-2051`, `:2554`, `:2980`) concerns the CLI's own HTTP to the CES control plane —
  status polling and artifact download — **not** the Copilot API. **[CODE]**
- One near-miss: `RETRYABLE_HARBOR_ERROR_TYPES` does list `RATE_LIMIT`
  (`execution/native_harbor/parse_harbor_results.py:20-45`) but it is harbor-native only,
  used at a single classification site (`:91`), and harbor-native cannot be mixed with
  standard container instances (`cli/msbench_cli.py:1873-1878`). It buys us nothing.

**Pacing is our responsibility.** `--workers N` is only `queryParams["maxParallel"]`
(`ces_client.py:905-907`), so parallel instances draw on the shared limiter concurrently.
`--repeat K` submits K independent runs each carrying all N instances (`total = instances × K`,
`cli/command_handlers/run_handlers.py:219-225`) — a straight K× multiplier on both cost and
request rate. `--parallel_repeats` exists specifically to drop the CES endpoint tag so
attempts run concurrently (`:121-135`), which maximises the rate at which requests hit
CAPI. Given §2.3, **pace on requests-per-minute rather than tokens**, and prefer
serialising pass@k attempts until the limiter is pinned down.

### 2.5 Fallback we investigated and deliberately passed on: BYOK

Documented so a future reader knows the option exists and why we did not take it.

`customModels` and `oaiProxy` are first-class `TestConfig` keys. Pointing the harness at
an Azure OpenAI resource in our own subscription would move us off the shared
`autodev-test` allowance entirely and onto quota we control and can raise through normal
Azure channels. Two auth modes: an API key delivered per vendor as `{VENDOR}_API_KEY` via
`extensionHostEnvFile` (with `--encrypted-env` available to ship the value —
envelope-encrypted with an Azure Key Vault RSA key, `utils/kv_encrypt.py:51-88`, and
excluded from run metadata via `Field(exclude=True)` on `AgentConfig.encrypted_env`); or —
better — **keyless**, using `oaiProxy` with an Entra scope, where the MSBench CES managed
identity authenticates to our endpoint and no secret exists to leak.

**Why we passed:** it costs real fidelity — we would stop exercising the actual Copilot
model path that production users hit — plus meaningful setup, and it moves spend onto our
Azure bill. Once `gpt-5.6-sol` was shown to route entirely off the contended surface
(§2.1), the trade stopped being obviously worth it. If it is ever revisited, the thing to
verify **first** is whether tool calling survives: the CAPI proxy and the
`overrideCapiUrl` settings are applied only when `modelSelector.vendor === 'copilot' || config.aiGrader`
(**[CODE]** `src/vsCodeApplication.ts:725-728`), yet Copilot Chat *"still calls CAPI
directly for client tools (e.g. `toolSearch` -> /embeddings)"* (`:782-786`). Under a BYOK
vendor those client tools may have no auth path — **[INFERRED]**, untested, and fatal to
us if true, since our agent depends on discovering and calling the extension's MCP tools.

### 2.6 Worth asking about, not investigated: `ces-ame`

`ces-dev1` is the argparse default in ~10 places and `run.sh` passes no `--backend`, so
**every run to date has gone to a dev CES**. Because the CAPI proxy is hosted by the same
CES instance (`Target: https://ces-dev1.azurewebsites.net/api/copilot` **[VERIFIED]**),
the backend choice also selects the Copilot proxy endpoint.

`ces-ame` reads as the production environment: different tenant
(`33e01921…` vs corp `72f988bf…`), different token scope, `cesbench.azurewebsites.net`,
a separate analysis site (`app-msbench-web-prod`), cross-tenant storage via
`AME_EVAL_RUNNER_APP_ID`, and **a completely separate Kusto cluster and database**
(`msbdikustoprodeus2.eastus2`/`msbench` vs `ces_telemetry_prod`) — **[CODE]**
`constants.py:1026-1090`, `config.py:623-625` and `:785-793`.

Consequences: **existing runs and reports do not carry over** — it is a separate data
plane, so run IDs will not resolve there. Whether its Copilot allowance differs is
**[UNKNOWN]**. Onboarding requirements are **[UNKNOWN]**. Ask `CodeExService@microsoft.com`
before attempting a submission.

---

## 3. Cost model

Measured with `msbench-cli report --view cost` across 12 stored single-turn runs
**[VERIFIED]**:

| steps | total | input | cached | uncached | output |
| --- | --- | --- | --- | --- | --- |
| 5 | 150,850 | 146,714 | 124,522 | 22,192 | 4,136 |
| 7 (×5) | 194,358 – 215,389 | | | 21,672 – 23,691 | 3,235 – 5,323 |
| 8 (×4) | 223,745 – 229,295 | | | 22,021 – 23,651 | 3,920 – 4,355 |
| 10 | 297,681 | 293,751 | 269,583 | 24,168 | 3,930 |

**Mean 206,614 total tokens per single-turn run** (the README's ~250k estimate was
slightly high). The structure matters more than the mean:

- **Uncached input is flat at ~22.4k regardless of step count.** That is the only genuinely
  new content.
- **Cached input is 83–91% of every run and grows with the transcript**, because each step
  re-sends the whole conversation.
- Output is flat at ~4.1k.

### 3.1 Per-step cost is rising — extrapolation is a floor, not an estimate

Marginal total tokens per additional step:

```
 5 ->  7 steps:  24,488 / step
 7 ->  8 steps:  26,846 / step
 8 -> 10 steps:  35,505 / step      <-- +45% vs the first band
```

Monotonically rising, exactly as the transcript-resend mechanism predicts. Fits:

| steps | linear (`29,269·s − 762`) | quadratic (`1,836·s² + 1,728·s + 96,551`) |
| --- | --- | --- |
| 20 | 584,623 | 865,546 |
| 40 | 1,170,008 | 3,103,422 |
| 60 | 1,755,393 | 6,810,177 |
| 100 | 2,926,164 | 18,630,327 |

> **Treat linear as a hard floor and quadratic as a loose ceiling.** The quadratic is
> fitted on only four distinct step counts (5–10) so its curvature is fragile, and real
> agents get context compaction that should bend it back down. But the *direction* is not
> in doubt: **do not extrapolate the linear model 10× and call it an estimate.**

**Implication for end-to-end scenarios — revised, and much less alarming than it first
looked.** A 60-step E2E session has a floor of ~1.76M total tokens. An earlier draft of
this document called that *"~2.4× the entire observed allowance"* and concluded such a run
would die mid-session. **That was wrong** — see §2.3. Against the real integration ceiling
of 31M TPM, a whole 60-step run's token volume is comfortably under a *single minute* of
quota. **Token volume per run is a non-issue at any scale we plausibly run.**

What survives is a different concern, and §2.3's leading hypothesis sharpens it: if the
binding limiter counts **requests**, then the cost that matters is the **step count**, not
the token total. These numbers are still the best proxy we have for how long a session is
— ~28k tokens per step means a 1.76M-token run is roughly 60 turns, i.e. 60+ upstream
requests — but the budget to watch is requests per unit time, not tokens per window.

The token figures remain worth keeping for capacity planning and for cost attribution;
just don't derive a throttling budget from them.

---

## 4. Model selection

### 4.1 The shipped catalogue is misleading in both directions

`COPILOT_VENDOR_MODELS` (**[CODE]** `msbench_agent_vscode/cli.py:1676`) lists **27** models,
all `vendor: copilot`, each with only `description` and `model: {id, vendor}` — **no
endpoint, capacity or quota metadata whatsoever**. (`_build_vscode_models_mapping` reports
28 because it adds a synthetic `default` entry; the underlying catalogue is 27.
**[VERIFIED]**) `msbench-cli discover models` returns **HTTP 403** for our identity
**[VERIFIED]**, so the live catalogue cannot be queried from the CLI.

Tested five ids in a single run using the §1 dispatcher, for ~15.8k tokens **[VERIFIED]**
(runs `2026082603685803`, `2026082604036532`):

| requested | result | observed |
| --- | --- | --- |
| `gpt-5.6-sol` | ✅ resolves, `resolved: true` | `Set active model to: gpt-5.6-sol` |
| `gpt-5-mini` | ✅ resolves | `Set active model to: gpt-5-mini` |
| `gpt-4.1` | ✅ resolves | `Set active model to: gpt-4.1` |
| `gpt-5` | ❌ `X_MODEL_NOT_FOUND_ERROR` | `Model not found in cached models: gpt-5` |
| `gpt-5.6` | ❌ `X_MODEL_NOT_FOUND_ERROR` | `Model not found in cached models: gpt-5.6` |

**`gpt-5.6-sol` is absent from the catalogue and works. `gpt-5` and `gpt-5.6` are present
and fail.** The catalogue is not a gate and not a guide — do not trust it in either
direction. `msbench-agent-vscode` 0.0.22 is the newest on the feed **[VERIFIED]**, so
there is no newer catalogue to upgrade to, and it would not help.

### 4.2 The real gate: live `GET /models`, hard error, no silent fallback

**[CODE]** `src/proxy/capiProxyServer.ts:60-71`:

```ts
const model = catalog.data.find(candidate => candidate.id === modelId);
if (!model) {
  throw new AgentApplicationError(`Model not found in cached models: ${modelId}`, 'X_MODEL_NOT_FOUND_ERROR');
}
```

Exact id match against the live `GET /models` response, then `is_chat_fallback` and
`model_picker_enabled` are set so VS Code cannot pick anything else (`:84-89`).

Two useful consequences. **There is no silent fallback** — a model sweep cannot quietly
collapse into N runs of a default, which is the "confidently wrong" failure class. And a
wrong id **costs ~0 tokens**, because the run dies at launch before the first turn; that is
what made testing five ids for 15.8k viable.

Existence is not identity, though. A cheap belt-and-braces check worth adding: assert
`capi-proxy.log` contains `Set active model to: <requested>`.

### 4.3 `--model .` vs `--model X` — a subtle trap

`run.sh` uses `--model .` (`ASSET_MODEL_SENTINEL`, `runner_constants.py:3`). On that path
the runner only requires that `modelSelector` be *present* in the asset file
(`_require_assets_model_selector`, `cli.py:1304`) and copies the file through unchanged.
**That byte-for-byte copy is exactly what makes wholesale per-instance config replacement
lossless** (§1.6).

With a real `--model X`, the runner strips and re-appends `modelSelector` **on the
top-level file only** (`runner_rendering/common.py:306-332`). Per-instance stimulus files
would silently keep whatever model was baked into them.

> **Recommendation: change `modelSelector.id` in `config/base.yaml` and keep passing
> `--model .`. Do not switch to a real `--model X`.** If you ever must, the dispatcher has
> to re-append `modelSelector` itself.

### 4.4 Caveat on the model evidence

All GPT runs above were 1-step trivial prompts (~16–18k tokens). They establish
**resolution and routing only**. Whether our assertions still pass on a GPT model, and
whether the per-step token profile is comparable under real load, is **[UNKNOWN]** — that
validity arm was not run.

---

## 5. Recovery: what exists, what does not

### 5.1 `resume` is monitoring-only

**`msbench-cli resume` does not re-execute anything.** Its own docstring says *"Resumes
monitoring of a previously started run."* **[CODE]** `cli/command_handlers/run_handlers.py:795-877`.
It resolves run ids, optionally expands a repeat batch, then either prints a snapshot or
calls `wait_for_finish` and downloads results. It is the fix for *your laptop* dying, not
for *the run* dying — CES keeps executing regardless.

- Re-runs completed instances? Neither — it does not run instances at all.
- Mid-instance or partial chat session? **No. There is no checkpointing within an agent
  session anywhere in the codebase.**
- After a RATE_LIMIT? No. That is a *completed* instance with an error result; resume
  re-reports it.
- The only thing it can start is missing **whole attempts** in a `--repeat` batch,
  submitted as brand-new runs (`_handle_run_batch_resume`, `:752-793`).

**A multi-million-token E2E run that throttles at 80% is lost in full.** There is no
partial credit.

### 5.2 Partial re-runs — and a correction

The recovery path is to re-submit only the broken instances and stitch with
`merge --merge_compat subset` (*"allow partial reruns where benchmarks are a subset of the
reference run"*).

`--benchmark` accepts a status selector against a report file — `resolved`, `unresolved`,
`error`, `missing`, plus `no_eval_or_error_json` and `no_error_json_unresolved`, which mean
"the harness broke, not the product" (**[CODE]** `benchmark_database.py:1519-1588`).

> **Correction to earlier advice — this does NOT work for dataset-driven suites.**
> **[VERIFIED]**:
>
> ```
> $ msbench-cli run … --benchmark /tmp/report.json:missing
> ERROR Instance 'say_hello.gpt_5_6_sol' not found in benchmark 'vscbench'
> ```
>
> Reports key instances by the *reformatted* name — benchmark `vscbench`, instance
> `say_hello.<instance_id>` (`reformat_image_tags_to_old_format`, `benchmark_database.py:371-379`)
> — while a custom dataset declares its own benchmark name and bare instance ids
> (`cormodel` / `<instance_id>` in the §4.1 model probe). The selector resolves against the
> dataset and finds nothing.
>
> **Re-select explicitly instead**, which is verified working:
> ```
> msbench-cli run … --benchmark cormodel.gpt_5_6_sol cormodel.gpt_5_mini
> ```

### 5.3 Blob loss is routine, not exceptional

In one 5-instance run, **2 instances returned `"missing"`** — no output blob, a known
infrastructure failure mode rather than a product signal **[VERIFIED]**. Both recovered
cleanly on an explicit re-run. Small sample, but plan the partial-re-run loop as **routine
plumbing**, not exception handling.

---

## 6. Traps that cost real time

Each of these cost at least one wasted run or a long detour.

**`SELECT 0` does not compile.** The assertion engine appends `WHERE stepIndex = :stepIndex`
to every query, so a bare select becomes `SELECT 0 WHERE stepIndex = :stepIndex` and the
whole run dies with `X_ASSERTION_DOES_NOT_COMPILE` **before the agent ever starts**
**[VERIFIED]**. Every assertion must be a real table query. For an always-false tripwire
use `SELECT COUNT(*) > 0 FROM files WHERE path LIKE '%__NEVER_EXISTS__%'`.

**No `@` prefix on report selectors.** `--benchmark @results.json:error` fails with
`Selection file not found: …results.json:error` — the CLI treats the whole token as a
literal filename. Without the `@` it resolves **[VERIFIED]**. (And see §5.2: for dataset
suites, don't use it at all.)

**`--timeout` on `msbench-cli run` cancels your run.** It is a *local* wait, and on expiry
*"the CLI attempts to cancel the CES run"*. Never set it low for long runs; prefer leaving
it unset.

**`timeouts.stallSeconds` defaults to 2700s (45 min)** and trips on *"no agent trace, CAPI
proxy log, Copilot Chat log, or workspace file activity"*. A long `npm install`,
`azd provision`, or test run can be silent on all four and kill an otherwise-healthy run.
`agentSeconds` defaults to 6300s (1.75h). Both are ordinary config with effectively
unbounded maxima. **[Already addressed](config/base.yaml) — #1700 set explicit values
(`agentSeconds: 18000`, `stallSeconds: 5400`, `runnerGraceSeconds: 900`); the trap is
recorded here so nobody reverts to the defaults without knowing what they mean.** The real
ceiling above these is the GitHub Actions job limit (runs report
`dispatched to GitHub Actions`), which is **[UNKNOWN]**.

**Invoking `msbench-cli` by absolute path breaks special-agent plugin discovery.** Always
put the venv on `PATH`: `export PATH="$HOME/.msbench-venv/bin:$PATH"`.

**Never dump the environment into an artifact.** A `script:` doing `env | sort` writes
into `customScript/output.log`, which is retained and shared. The container ships BYOK key
slots (`OPENAI_API_KEY`, `AZURE_API_KEY`, `ANTHROPIC_API_KEY`, and six more) that are
currently unsubstituted `{{ template_placeholder }}` values — harmless today, a live secret
leak the moment anyone enables BYOK. Log **variable names only**:
`env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' | sort`.

**Timestamps in `msbench-cli list runs` are local-DB write times**, not run times — the
tool says so. Simply generating a report rewrites them. For real timing use `show_run`,
which reports `timestamps.initialized` / `.completed` **[VERIFIED]**.

**Check `error.json` before believing any red run.** Covered in the
[README's troubleshooting](README.md#troubleshooting); the point bears repeating because a
throttled run looks exactly like an agent regression.

---

## Appendix: artifacts worth knowing about

`msbench-cli extract --run_id <id> --output <dir>` yields, per instance:

| Path | Why you care |
| --- | --- |
| `output/vsc-output/capi-proxy.log` | upstream calls with paths and status codes — **the 429 evidence**, and which surface |
| `output/vsc-output/configs/msbench-user-overrides.yaml` | the **effective** config the run actually used — proof of what ran |
| `output/vsc-output/session.sqlite` | all agent execution data; `files(path, content, stepIndex)` holds **full file contents** |
| `output/vsc-output/customScript/output.log` | your `script:` stdout |
| `output/error.json` | `type` — `RATE_LIMIT`, `X_MODEL_NOT_FOUND_ERROR`, `X_ASSERTION_DOES_NOT_COMPILE`, … |
| `output/vsc-output/patch.diff`, `screen_recording.mp4`, `final-screenshot.jpeg` | triage |

Because `files.content` carries full contents, **assertions can be re-evaluated offline at
zero token cost**: rehydrate the workspace from the DB and re-run `exec:` graders there,
and re-run SQL assertions with
`vsc-eval assertions assert --database-file <extracted session.sqlite> --config-path <new config> …`
— the identical command `run-agent.sh:504` runs in-container. MSBench has no `regrade`
subcommand (`msbench-cli grader` offers only `validate`) and needs none;
[`regrade.ts`](regrade.ts) implements this locally (#1704). Grader iteration therefore
costs no model tokens at all, which makes it the right development loop.

### Runs referenced

| Run | What it established |
| --- | --- |
| `2026082579322454` | green Claude baseline; `Integration ID: autodev-test`; surface census |
| `2026082583236973` | the throttled run; **surface-scoped 429**; RATE_LIMIT is terminal mid-session |
| `2026082601666109` | `INSTANCE_ID` is image-derived; **`instanceId` carries the dynamic id** |
| `2026082602313040` | dispatcher proven end to end, 3 independent channels, 2/2 resolved |
| `2026082603685803` | model resolution matrix; `gpt-4.1` census clean of `/v1/messages` |
| `2026082604036532` | `gpt-5.6-sol` and `gpt-5-mini` resolve; explicit partial re-run works |
