# Running the agent evals on MSBench

The Vally suite in `evals/` runs the `azure-project-plan` agent headlessly through the
Copilot SDK. This folder runs the *same contracts* against the **real extension** in
**real VS Code** on [MSBench](https://aka.ms/msbench), via the `vscode` special agent.

The two are complementary, not redundant:

| | `evals/` (Vally) | `evals/msbench/` |
| --- | --- | --- |
| Runs | Copilot SDK, headless | Real VS Code + our VSIX |
| Tools | `evals/mcp/workflow-tools-server.mjs` stand-in | The extension's in-process MCP server |
| Webviews | Never opened | Actually rendered |
| Where | GitHub Actions, ~30 min | MSBench CES, with video + screenshots |
| Role | Fast PR gate | Nightly, pass@k, model sweeps |

## Quick start

```bash
az login          # once
./run.sh          # builds the VSIX, installs tooling, submits the run
```

First run takes ~10 minutes end to end (~4 min of that is MSBench). Re-run without
rebuilding the extension using `./run.sh --skip-build`.

`run.sh` is self-contained: it provisions a Python 3.10+ virtualenv, installs
`msbench-cli` plus the `vscode` special agent from the internal feed, builds and
stages the VSIX, and submits. The only prerequisites are Azure CLI and Node.

## Suites

One MSBench run is one config, and `promptSteps` is a multi-turn sequence rather than a
list of scenarios, so each Vally stimulus is its own suite:

```bash
node stage.mjs --list                        # what is available
./run.sh --suite scaffold-unapproved-plan    # pick one
```

| Suite | Stimulus | Cost |
| --- | --- | --- |
| `project-plan` (default) | `photo-app-requirements` | cheap |
| `seed-plan-fullstack` | produces the fullstack seed | planning only |
| `seed-plan-api-only` | produces the API-only seed | planning only |
| `scaffold-missing-plan` | `missing-plan-stops` | cheap |
| `scaffold-unapproved-plan` | `unapproved-plan-stops` | cheap |
| `scaffold-fullstack` | `fullstack-opens-preview-gate` | scaffolds + builds |
| `scaffold-api-only` | `api-only-hands-off-directly` | scaffolds + builds |
| `scaffold-autopilot` | `autopilot-skips-preview-gate` | scaffolds + builds |

The scaffold agent's first action is reading `.azure/project-plan.md`, and nothing in
the container puts one there. The seed comes from a real planning-agent run rather than
a checked-in file, so produce it once before the first scaffold suite:

```bash
# from the repo root
./evals/msbench/run.sh --suite seed-plan-fullstack
node evals/msbench/harvest-seed.mjs --run-id <id> --target fullstack

./evals/msbench/run.sh --suite seed-plan-api-only
node evals/msbench/harvest-seed.mjs --run-id <id> --target api-only

npm run eval:msbench:seed:check   # confirms the seed matches resources/agents/
```

The seed runs the planner in the same VS Code harness the scaffold suites are measured
in. An SDK-driven generator would be cheaper, but it drives Copilot CLI headlessly and
behaves differently from this harness, so the seed would be produced under one runtime
and consumed under another.

`harvest-seed.mjs` refuses to promote a run whose assertions did not all pass — including
the liveness sentinel — so a broken planner, or a run voided by a rate limit, surfaces as
"could not harvest seed" rather than quietly becoming a fixture that bakes the break into
every scaffold suite.

`scaffold-fullstack` and `scaffold-autopilot` deliberately share one seed, differing
only in the `[AUTOPILOT MODE]` prompt prefix and the two inverted gate assertions. That
pairing is what makes the gate decision falsifiable: an agent that always opens the
gate, or never does, fails exactly one of the two. `scaffold-unapproved-plan` shares the
same planner trial as `scaffold-fullstack`, differing by one row — its `Status`.

### How assets get staged

`stage.mjs` builds `.staged/`, which is what gets uploaded as `--agent-assets` and
appears at `/agent/assets` in the container:

```
.staged/
  user-overrides.yaml    the chosen suite's config
  extensions/            the VSIX
  graders/*.mjs          the eval graders, bundled
  workspace-seed/.azure/ the generated plan (scaffold suites only)
```

Graders are **bundled with esbuild** rather than copied. Run from source they are `.ts`
files importing across `evals/src/`, which needs both that directory layout reproduced
in the container and a Node new enough to strip types (>=22.18). Bundling collapses each
to one dependency-free `.mjs` targeting Node 18, so the container only has to run ESM.
They are built from the same sources `graderCertification` certifies, so the certified
path and the MSBench path stay the same code.

`.staged/` is rebuilt from scratch each run and gitignored, which keeps `assets/`
pristine and — more importantly — stops a previous suite's seed leaking into the next
one, where a stale `.azure/` would quietly turn "no plan on disk" into a pass.

### Validating suites without submitting

```bash
# from the repo root
npm run eval:msbench:validate
```

`run.sh` runs this before staging, and CI runs it in the credential-free `build` job.
A suite config is otherwise only parsed inside the container, after a VSIX build and an
Azure login, where a typo is indistinguishable from a failed eval. It checks the things
that have actually gone wrong: YAML that does not parse (an unquoted
`exec: grep -q '**Status**: Planning'` reads as a nested mapping and takes the run
down), a `files` query while snapshotting is off, a suite in `suites/` that `stage.mjs`
cannot stage, and an `exec` naming a grader that does not exist.

### Access

You need the **`MSBench User`** role, requested at <https://aka.ms/msbench/access>
(manager approval; syncs within the hour). That is the *only* access prerequisite —
it grants the artifact feed, ACR, and Kusto in one go. Nothing else needs
provisioning, and no other team needs to be involved.

`run.sh` mints the feed token with `az account get-access-token` rather than using
`keyring`, which otherwise drops into an interactive prompt and hangs.

Until the role syncs, the install step fails like this:

```
ERROR: No matching distribution found for msbench-cli
```

That message is misleading — the package exists, but pip renders the feed's `403`
as if it were missing. `run.sh` queries the feed on failure and prints the real
reason ("lacks permission ... You need to have `ReadPackages`") along with the
identity it used, so a missing entitlement is distinguishable from a typo, an
expired login, or a VPN problem. Being signed in to `az` is not the same as being
entitled; the role is a separate request.

## Verified result

Runs `2026082467524759`, `2026082468156047` (from a clean venv) and `2026082471095778`
— **all 7 assertions passed**, `resolved: true`, every time. The agent produced a
236-line `.azure/requirements.json` and called the extension's real
`open_requirements_view` tool (as `mcp_copilot_azure_open_requirements_view`).

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

There is also an LLM-as-judge assertion (`comment` + `prompt`) with no Vally
equivalent, worth considering for the qualitative parts of a plan.

### Why the scaffold suites avoid the `files` table

`snapshotWorkspace` defaults to on, copying the whole workspace into `session.sqlite`
after **every step** — which is what makes `files` queries possible. The scaffold
stimuli generate an entire project and then run a real `npm install`, so snapshotting
would be copying `node_modules` after each step: the "multi-gigabyte / times out the
run" case the schema itself warns about. There are no path exclusions; it is all or
nothing.

So the scaffold suites set `snapshotWorkspace: false` and express **every** file check
as `exec` instead:

| Vally grader | scaffold suite assertion |
| --- | --- |
| `file-exists` | `exec: test -e /workspace/…` |
| `file-not-exists` | `exec: test ! -e /workspace/…` |
| `file-matches` | `exec: grep -q … /workspace/…` |
| `program` | `exec:` running the bundled grader |

`toolCalls` and `llm_responses` assertions are unaffected — they keep working with
snapshotting off. The run fails fast if any assertion queries `files` while it is
disabled, so a mistake here is loud rather than silent.

This turned out to be the better mapping anyway: the `program` graders run as
themselves rather than as a SQL approximation of themselves, so there is no second
implementation of the contract to drift.

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

`vally-evals.yml` needs no secrets — `copilot-requests: write` lets the built-in
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

Three failure modes cost real time while building this, all of which now fail fast in
`run.sh` with a clear message:

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

Two more that show up only after a real submission:

- **`RATE_LIMIT` kills the run.** The underlying error is transient — the message
  literally says "please wait 1 seconds" — but the harness treats any rate limit as
  fatal and abandons the whole run, so a momentary hiccup costs ~20 minutes. Retry, or
  batch several attempts in one go (extra flags pass straight through to `msbench-cli`):

  ```bash
  ./run.sh --suite scaffold-unapproved-plan --skip-build --repeat 3
  ```

  Note the gate suites are only cheap when the agent *behaves*. Runs
  2026082555313888 and 2026082561519259 each burned ~1.8-2.1M tokens over 33-39 steps
  precisely because the agent bypassed the gate and scaffolded a full project, which
  makes the failure mode the expensive one and rate limits more likely on exactly the
  suites that are catching a bug.

- **A rate-limited run reports scores anyway, and they are meaningless.** MSBench still
  evaluates assertions against an empty session database, where `COUNT(*) = 0` checks
  pass vacuously. The sentinel assertion at the top of each scaffold suite exists to
  make this unmistakable: if it fails, ignore every other result in the run and retry.
  Read `patch.diff` for what the agent actually did.

## Next steps

- The remaining project-plan stimuli, plus its `program` validators as `exec:`
  assertions — the scaffold suites already do this, so the staging machinery exists.
- The three multi-turn stimuli, using `promptSteps` (native multi-turn).
- Confirm the container's Node version. The graders are bundled for Node 18 so this
  should not matter, but it has not been observed on a real run.
- Nightly CI once the CES identity is allowlisted; keep `vally-evals.yml` as the fast PR
  gate.
- Expand gates and graders, including browser assertions for the preview canvas.

Longer term these could graduate into `benchmarks/azure/` in
`vscode-copilot-evaluation`, alongside the GitHub Copilot for Azure team's deployment
scenarios (owner `fanyang-mono`). That buys a dedicated image and a richer starting
workspace, at the cost of a publish step — worth it once the set of stimuli is stable.
