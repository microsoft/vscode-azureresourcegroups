# MSBench suites

Each subdirectory is one suite: a `user-overrides.yaml` staged as the last of the
three config layers described in [`README.md`](./README.md).

```bash
./stage.sh --list          # local-dev, project-plan
./stage.sh local-dev       # assemble assets/
./preflight.sh local-dev   # verify offline, before spending a run
./run.sh --skip-build      # submit
```

`stage.sh` copies the chosen suite's config to `assets/user-overrides.yaml`, which
is what `run.sh` already reads — so `run.sh` needs no changes and no `--suite` flag.

## `preflight.sh`

An MSBench run is ~15 minutes and costs model calls, so it is worth catching the
cheap mistakes first. `preflight.sh` stages the suite and then checks:

- the config parses, and every `/agent/assets/...` path it references was staged
- every `query:` is valid SQLite against the real assertion schema
- every `exec:` **fails** against the workspace as the agent first sees it
- every `exec:` **passes** against a workspace in the expected state for its step

The third check is the important one: an assertion that passes against an untouched
workspace is worse than no assertion, because it reports green. The fourth is its
mirror — it catches an assertion so strict that even a correct agent fails it.

Note that the reference for the fourth check is **step-dependent**. A gate assertion
is phase-scoped (it requires the plan to still be at `Planning`), so validating it
against a completed project would wrongly report it broken. Step 0 is checked against
a synthesized planning-state workspace, later steps against the completed fixture.

Preflight cannot check agent behaviour, the extension host, tool-call names as VS Code
reports them, or whether the hand-off is observed. Those need a real run.

## Why `exec:` instead of hand-translated SQL

The original port turned each Vally grader into a SQL assertion by hand. That works
for existence and tool-call checks, but it creates a **second copy of every contract**
that has to be mirrored whenever the first changes — the risk the top-level README
calls out.

`stage-graders.sh` removes the need. It stages a self-contained bundle so the *real*
graders run in-container:

```
assets/graders/
  evals/graders/*.ts                       grader entry points
  evals/src/artifacts/*.ts                 the validators
  src/webviews/.../views/utils/            the product parsers they import
  node_modules/jsonc-parser/               vendored; zero dependencies
```

The layout mirrors the repo, so every relative import resolves unchanged and no file
needs editing. `jsonc-parser` is vendored rather than dropped because the extension
itself ships and uses it — a file the grader accepts should be one the product can read.

This is what the top-level README anticipated when it said the full contract check
"lands next as an `exec:` assertion". `project-plan`'s requirements check is now the
real `validate-requirements.ts` rather than a JSON-shape approximation.

### What SQL is still better at

`exec:` collapses the graders' three-way exit code (0 pass / 1 product failure /
3 grader fault) into pass/fail, so SQL is kept for the things a filesystem grader
genuinely cannot see:

- **tool calls** — `toolCalls` has no filesystem equivalent
- **chat prose** — `llm_responses` likewise
- **per-step provenance** — `stepIndex` is auto-appended to every query, so an
  assertion sees only its own turn

That last one is a capability Vally lacks. `validate-debug-gate.ts` had to *drop* its
docker-compose check, because a scaffolded project may legitimately ship a compose file
and a post-hoc grader cannot distinguish that from a premature write. In `local-dev`
the check is restored as a step-scoped query.

## Suites

### `project-plan`
The `photo-app-requirements` stimulus. Ported from `evals/project-plan/eval.yaml`.

### `local-dev`
The local development phase — `azure-debug-plan` → `azure-debug-generate` — carrying
all four debug graders from `evals/local-dev/eval.yaml`.

It starts **mid-workflow**, because the debug agents analyse an existing project rather
than create one. `stage-workspace.sh` seeds one from
`evals/grader-certification/reference-node-fullstack`, reusing the grader certification
fixture so the seed cannot rot independently of the graders.

The seed deliberately **excludes** `.vscode/`, `.azure/vscode-debug-plan.md`,
`api-test-collections/` and `docker-compose.yml`. Those are the artifacts under test;
seeding them would let every assertion pass without the agent doing anything. The
stager asserts their absence, and all four graders exit 1 against the bare seed and 0
against the completed fixture — so the assertions are falsifiable in both directions.

#### Known limitation: the hand-off

`start_azure_debug_generate` calls `openChatWithAgent`, which runs
`workbench.action.chat.newChat` — fire-and-forget, with no session handle. `promptSteps`
drive a *single* session, so whether MSBench observes the spawned agent is **unverified**.

Step 2 covers the case where it does not: it repeats the hand-off prompt verbatim from
`startAzureDebugGenerateCommand`, so it is the exact query the product sends. If the
native hand-off is observed, that step is a harmless restatement.

`promptSteps[].handoff: { id }` is the schema-native alternative and would be cleaner,
but the ids come from `workbench.action.chat.getHandoffs` and can only be discovered
from a live run. Worth revisiting once one has been captured.

## Relationship to PR #1689

#1689 merged into `feat/CoR` on 2026-08-25 and is what provides `run.sh`, the README,
and the CI workflow. It tracked `assets/user-overrides.yaml` (renamed from
`cor-requirements.vscode.agent.yaml`).

Under this layout that path is **generated**, so this branch completes the migration:

1. the tracked `assets/user-overrides.yaml` is deleted — `project-plan/user-overrides.yaml`
   supersedes it and carries the `exec:` upgrade, replacing the SQL stand-in that
   #1689's README flagged as partial
2. `evals/msbench/assets/user-overrides.yaml` is `.gitignore`d alongside the other
   generated asset paths
3. `msbench-evals.yml` runs `./stage.sh project-plan && ./preflight.sh project-plan`
   before `run.sh --skip-build`

The consequence: **`run.sh` now requires `./stage.sh <suite>` first.** It no longer
works straight from a clean checkout, because the config it reads is no longer
committed. `stage.sh` does not touch `assets/extensions/`, so it is safe to run
either side of the vsix download.

## Unverified in-container

- **Docker** — unknown, which is why no assertion boots an emulator.

## Runtime graders (planned)

Everything today is **structural**: the graders import only `node:fs` and `node:path`,
so they check that artifacts are well-formed and mutually consistent, never that the
project runs. A `launch.json` referencing a port nothing binds passes.

The weakest link is the checklist assertion — the agent *self-reports* having validated
its work and the grader only confirms the checklist is filled in, not that its evidence
is real. A plausible fabricated checklist passes.

MSBench makes the next rung possible, gated on the capability probe in `local-dev`'s
`script:` block (read `customScript/output.log` from an extracted run):

| Rung | Check | Needs |
| --- | --- | --- |
| Cheap | `docker compose config` parses and resolves | compose file only |
| Cheap | generated watch/build task actually compiles | toolchain |
| **Medium** | `docker compose up -d`, poll healthchecks, then run the generated `api-test-collections/**/invoke.sh` | **Docker daemon** |
| Expensive | drive F5 via the debug API, assert a breakpoint binds | VS Code automation |

The medium rung is the first that proves local debug *works*, and is the one worth
building if the probe reports a usable daemon. It also turns the checklist assertion
from self-report into corroboration: the invoke scripts either return the documented
status codes or they do not.


## Trap: the container's Node is older than yours

The container runs **Node 22.22**; a current dev machine runs **Node 24**. Node 24
treats a bare `.ts` file as ESM, Node 22 treats it as CommonJS. So a bundle without
a `package.json` declaring `"type": "module"` works perfectly locally and dies
in-container on the first `import` with *"Cannot use import statement outside a
module"*.

Locally that marker is supplied by `evals/package.json`, which Node finds by walking
up — but the bundle is extracted to `/agent/assets`, where there is no ancestor
`package.json` at all. `stage-graders.sh` therefore writes one into the bundle and
asserts it **statically**, because no local run can catch this behaviourally.

This cost run [`2026082568864133`](https://msbenchapp.azurewebsites.net/run-analysis/2026082568864133),
where all five `exec:` assertions failed with exit 1 — indistinguishable from a real
product failure, which is the sharp edge of `exec:` noted above. When an `exec:`
assertion fails, **read `exec.output` from `session.sqlite` before believing it**:

```bash
msbench-cli extract --run_id <id> --output ./out
sqlite3 ./out/*-output/output/vsc-output/session.sqlite \
  "SELECT stepIndex, exitCode, output FROM exec ORDER BY id;"
```

