# Running the agent evals on MSBench

The Vally suite in `evals/` runs the `azure-project-plan` agent headlessly through the
Copilot SDK. This folder runs the *same contracts* against the **real extension** on
[MSBench](https://aka.ms/msbench), using the `vscode` special agent from
[`microsoft/vscode-copilot-evaluation`](https://github.com/microsoft/vscode-copilot-evaluation).

The two are complementary, not redundant:

| | `evals/` (Vally) | `evals/msbench/` (vscbench) |
| --- | --- | --- |
| Runs | Copilot SDK, headless | Real VS Code + our VSIX |
| Tools | `evals/mcp/workflow-tools-server.mjs` stand-in | The extension's in-process MCP server |
| Webviews | Never opened | Actually rendered |
| Where | GitHub Actions, ~30 min | CES, with video + screenshots |
| Role | Fast PR gate | Nightly, pass@k, model sweeps |

## Why the VSIX route

`contributes.mcpServerDefinitionProviders` registers an in-process MCP server
(`src/chat/tools/copilotOnRails/registerCopilotOnRailsTools.ts`) exposing
`open_requirements_view`, `open_plan_view`, `start_project_scaffold` and the rest.
Those are the exact names the Vally graders assert on, so the assertions port across
unchanged — but here they are satisfied by the shipping code path rather than a
test double.

## Prerequisites

1. `msbench-cli` installed and authenticated — see the
   [MSBench quickstart](https://github.com/devdiv-microsoft/MicrosoftSweBench/wiki/1.-Quickstart-for-installing-and-running-MSBench-CLI).
2. `az login --use-device-code`.
3. A VSIX built at the repo root:

   ```bash
   npm run package
   cp *.vsix evals/msbench/vscode-azureresourcegroups.vsix
   ```

## Run it

Iterate locally first — this uses Docker and never touches CES:

```bash
runtest local --benchmark vscbench.say_hello --agent vscode \
  --config evals/msbench/cor-requirements.vscode.agent.yaml
```

Then on CES:

```bash
msbench-cli run --agent vscode --model . \
  --benchmark vscbench.say_hello \
  --agent-assets evals/msbench/
```

`--model .` selects the `modelSelector` from the config, and is required for the
`vscode` agent.

Results land on <https://aka.ms/msbench>. Beyond pass/fail you get a screen recording,
per-step screenshots, the chat export, and per-step tool calls — see
[AGENT_OUTPUTS.md](https://github.com/microsoft/vscode-copilot-evaluation/blob/main/doc/references/AGENT_OUTPUTS.md).

## Assertion mapping

Vally graders translate to vscbench assertions nearly one-to-one:

| Vally grader | vscbench assertion |
| --- | --- |
| `file-exists` | `SELECT COUNT(*) > 0 FROM files WHERE path LIKE …` |
| `file-not-exists` | `SELECT COUNT(*) = 0 FROM files WHERE path LIKE …` |
| `tool-calls` (`required`) | `SELECT COUNT(*) > 0 FROM toolCalls WHERE tool LIKE …` |
| `tool-calls` (`disallowed`) | `SELECT COUNT(*) = 0 FROM toolCalls WHERE tool LIKE …` |
| `transcript-not-contains` | `SELECT COUNT(*) = 0 FROM llm_responses WHERE response LIKE …` |
| `constraints.reject_tools` | `SELECT COUNT(*) = 0 FROM toolCalls WHERE tool LIKE …` |
| `program` | `exec:` (defaults to asserting exit code 0) |

Every table carries a `stepIndex` column, and an `AND stepIndex = :stepIndex` filter is
appended automatically so an assertion only sees its own turn — which is what makes the
multi-turn stimuli in M3 straightforward. `llm_responses.response` holds user-facing
prose only, excluding tool output and thinking blocks, so substring assertions don't
false-match text the agent merely read.

There is also an LLM-as-judge assertion (`comment` + `prompt`), which has no Vally
equivalent and is worth considering in M5 for the qualitative parts of a plan.

Full reference:
[AGENT_ASSERTIONS.md](https://github.com/microsoft/vscode-copilot-evaluation/blob/main/doc/references/AGENT_ASSERTIONS.md).

## Status

M1 covers one stimulus (`photo-app-requirements`) with seven assertions, deliberately
SQLite-only so there is nothing to install in the container. The `requirements-schema-valid`
program grader is approximated with a `json_valid`/`json_extract` shape check; the real
validators (`validate-requirements.ts`, `validate-project-plan.ts`) come next as `exec:`
assertions, which needs the repo checkout and a Node version that strips types.

Remaining work:

- **M2** — the other three single-turn stimuli, plus the `exec:` validators.
- **M3** — the three multi-turn stimuli, using `promptSteps` (native multi-turn).
- **M4** — nightly workflow; keep `vally-evals.yml` as the fast PR gate.
- **M5** — expand gates and graders, including browser assertions for the preview
  canvas.

Once stable, these should graduate into `benchmarks/azure/` in
`vscode-copilot-evaluation` alongside the GitHub Copilot for Azure team's
deployment scenarios, rather than living here indefinitely.
