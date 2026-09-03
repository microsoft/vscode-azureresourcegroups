# `functions-postgres` — the checked-in plan fixture

`.azure/project-plan.md` here is the **fallback seed** for the scaffold and local-dev
stimuli. `evals/msbench/stage-workspace.ts` copies it into a run's workspace (rewriting
only the `**Status**:` line) when nothing has been harvested, and
`evals/local-dev/eval.yaml` seeds the same document.

## Provenance

Captured from a real end-to-end *Create New Project with Copilot* run in VS Code on
**2026-09-02**, from the prompt:

> Build a task tracker with a React frontend, an Azure Functions HTTP backend, and a
> PostgreSQL database for durable storage. Uploaded attachments are held in Blob Storage.

It is the `azure-project-plan` agent's own output, taken at the approval gate before the
plan was approved, with `**Status**` normalised to `Approved`. Nothing else was edited.

This is **not** a harvested seed in the `evals/msbench/seeds/` sense: that path records an
MSBench `runId` + `instance` and can be staleness-checked against `agent-assets.lock.json`
(`node harvest-seed.ts --check`). A local VS Code run has no run id, so claiming one would
have been false. A harvested seed still wins when present — see `stage-workspace.ts`.

## Why it was replaced

The previous fixture was hand-written and had drifted from the template the plan agent
actually emits. It **failed the suite's own validator**:

    $ node evals/graders/validate-project-plan.ts --expect-status=Approved
    FAIL: [missingSection] $: Missing required "next steps" section.

Three differences mattered, all of them things a real plan has and the old fixture did not:

| | old fixture | real agent output |
|---|---|---|
| per-service sections (`## 2` Backend, `## 3` Frontend) | absent | present |
| `## 5. Prerequisites` | four bullets | `### Run` + `### Debug` tables (`Tool \| Service(s) \| Installed \| Version`) |
| `## 9. Next Steps` | absent | present |

The per-service sections are the ones carrying each service's language, runtime and
framework, which is the scaffold agent's primary input — so the seed was withholding the
very fields the phase under test consumes.

## Keeping it honest

The seed is an **input, never an expected answer** (see `stage-workspace.ts` for the full
argument). No scaffold grader reads it; they assert against `resources/agents/**`. A stale
plan therefore makes trials fail *loudly* and cannot make a broken scaffolder look green.

If you edit this file, re-run the validator from this directory — it is the same command
that caught the drift above:

    node ../../../graders/validate-project-plan.ts --expect-status=Approved
