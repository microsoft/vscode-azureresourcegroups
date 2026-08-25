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

The single stimulus ported here is [`photo-app-requirements`](../project-plan/eval.yaml)
— its six graders plus the `reject_tools` constraint become the seven assertions in
`assets/user-overrides.yaml`. `evals/project-plan/eval.yaml` stays the source of truth;
this folder is a port of it, so changes there need mirroring here until the remaining six
stimuli are wired up.
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

### Access

You need the **`MSBench User`** role, requested at <https://aka.ms/msbench/access>
(manager approval; syncs within the hour). That is the *only* access prerequisite —
it grants the artifact feed, ACR, and Kusto in one go. Nothing else needs
provisioning, and no other team needs to be involved.

`run.sh` mints the feed token with `az account get-access-token` rather than using
`keyring`, which otherwise drops into an interactive prompt and hangs.

## Verified result

**All 7 assertions passed, `resolved: true`, on every run below** (links need
Corpnet/Azure VPN):

| Run | Base branch | Notes |
| --- | --- | --- |
| [`2026082467524759`](https://msbenchapp.azurewebsites.net/run-analysis/2026082467524759) | Copilot-on-Rails | first green run |
| [`2026082468156047`](https://msbenchapp.azurewebsites.net/run-analysis/2026082468156047) | Copilot-on-Rails | from a clean venv |
| [`2026082471095778`](https://msbenchapp.azurewebsites.net/run-analysis/2026082471095778) | Copilot-on-Rails | CI-style flags |
| [`2026082478636953`](https://msbenchapp.azurewebsites.net/run-analysis/2026082478636953) | Copilot-on-Rails | control |
| [`2026082479418416`](https://msbenchapp.azurewebsites.net/run-analysis/2026082479418416) | `feat/CoR` | this PR's base |

The agent produced a 236-line `.azure/requirements.json` and called the extension's real
`open_requirements_view` tool (as `mcp_copilot_azure_open_requirements_view`).

> **Flaky failure mode:** back-to-back runs can fail with `"type": "RATE_LIMIT"` in
> `output/error.json` — the Copilot API rate-limits the agent mid-run, so the artifact
> assertions fail simply because nothing was produced. This is not a product failure.
> Leave a few minutes between runs, and check `error.json` before believing a red result.

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

## Next steps

- The other three single-turn stimuli, plus the real `program` validators as `exec:`
  assertions (needs a repo checkout in the container).
- The three multi-turn stimuli, using `promptSteps` (native multi-turn).
- Nightly CI once the CES identity is allowlisted; keep
  [`agent-contracts.yml`](../../.github/workflows/agent-contracts.yml) as the fast PR
  gate.
- Expand gates and graders, including browser assertions for the preview canvas.

Longer term these could graduate into `benchmarks/azure/` in
`vscode-copilot-evaluation`, alongside the GitHub Copilot for Azure team's deployment
scenarios (owner `fanyang-mono`). That buys a dedicated image and a richer starting
workspace, at the cost of a publish step — worth it once the set of stimuli is stable.
