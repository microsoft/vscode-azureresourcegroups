# Why this fixture carries files no harvest could produce

`stage-local-dev` is `stage-scaffold` plus the inputs a debugged workspace needs.
Three of them are hand-written, and one of those is hand-written **necessarily**
rather than for convenience.

| File | Why it is not harvested |
| --- | --- |
| `.vscode/launch.json` | the local phase stops at the debug **plan**; `azure-debug-generate` never runs, so no run has produced one |
| `.vscode/tasks.json` | same |
| `debug-probe.json` | harness input; it is what the stimulus points the probe at |
| `services/functions/local.settings.json` | **it is gitignored by design, so it can never appear in a `patch.diff`** |

That last row is the interesting one, and it was found the expensive way.

## `local.settings.json` cannot be harvested, ever

`func start` will not run without it: it declares `FUNCTIONS_WORKER_RUNTIME`,
`AzureWebJobsStorage`, and the app settings the generated code reads. It is also
the file the scaffold agent is *instructed* to gitignore from the first commit,
because it holds connection strings — see the `.gitignore` rule in
`azure-project-scaffold/instructions.md`.

Both are correct, and together they mean a harvested Functions fixture is
**always** unrunnable. `harvest-stage.ts` reads the agent's `patch.diff`, and a
gitignored file is not in it. No amount of re-harvesting fixes that.

Measured, on run
[`2026090178170878`](https://msbenchapp.azurewebsites.net/run-analysis/2026090178170878):

```
resolved services/functions/src/functions/health.ts:12
debug adapter "node" is installed
preLaunchTask "func: host start" resolves in this environment   <- the extension works
trigger port 127.0.0.1:7071 is free
                                                                <- then 240s of nothing
outcome: appFailedToStart
detail:  startDebugging(...) never resolved within the probe budget —
         an unfinishable preLaunchTask is the usual cause
```

`func`, `azurite`, `psql` and a built `dist/` were all present. The background
task never reported ready because `func host start` had no settings file to start
from.

The values here are the local-development ones the fixture's own emulators serve:
Azurite via `UseDevelopmentStorage=true`, and the `taskuser`/`tasktracker`
PostgreSQL role the phase preamble creates. `languageWorkers__node__arguments`
opens the inspector on 9229, which is the port `launch.json` attaches to — that
is the link that makes `request: attach` work at all, and it is normally written
by the Azure Functions extension when it generates a debug configuration.

**Nothing here is graded.** These are inputs that make the tree runnable, which is
why the fixture deliberately does not certify `debug-config` or `debug-artifacts`
— those grade `.vscode/**` against the plan, and grading our own inputs would be
a verdict about us.
