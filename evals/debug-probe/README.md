# `evals/debug-probe` — does F5 actually work in the generated project?

Copilot on Rails promises that after scaffolding you can press F5 and debug the
project the agent just wrote. Every gate we have checks *artifacts*: that
`launch.json` and `tasks.json` exist and are well-formed. That is necessary and
weak — a `launch.json` can be perfectly valid and still not work.

This directory holds the gate that checks the promise itself: **a breakpoint is
hit in the generated project.** MSBench runs real VS Code with our real VSIX, so
it is the only place such a gate can exist.

```
extension/     the probe: a test-only VS Code extension, installed alongside our VSIX
certify.ts     proves the gate passes on known-good code and goes red on mutations
```

The grader that reads the probe's verdict lives with the other graders, at
[`evals/graders/validate-debug-breakpoint.ts`](../graders/validate-debug-breakpoint.ts).

## ⚠️ This is the one thing under `evals/` with a build step

Everything else here runs straight off `.ts` via Node 22's type stripping — no
compile, no emitted JavaScript. **The probe cannot.** The VS Code extension host
does not strip types, so `extension/` compiles to `out/` with `tsc` and ships as
a `.vsix`. It is still TypeScript-only in source; there is simply no way to load
a `.ts` file into the extension host.

```bash
cd extension && npm install && npm run compile   # -> out/extension.js
cd extension && npm run package                  # -> cor-debug-probe.vsix
```

`out/`, `node_modules/` and `*.vsix` are gitignored.

## How it works

The probe activates on startup, reads `debug-probe.json` from the workspace, and:

1. checks the requested configuration exists in the project's own `launch.json`
2. **resolves a breakpoint by pattern**, never by line number
3. `addBreakpoints()` + `startDebugging()` against that configuration
4. fires an HTTP trigger until something accepts a connection
5. waits for the DAP `stopped` event, then reads the frame and its locals
6. writes `.eval/debug-verdict.json`

```json
{
  "launchConfig": "Golden App (debug)",
  "breakpoint": { "glob": "src/**/*.js", "pattern": "status:\\s*'ok'" },
  "trigger": { "url": "http://127.0.0.1:7071/api/health" },
  "timeoutMs": 90000
}
```

With no `debug-probe.json` present the probe does nothing, so it is safe to
install unconditionally.

## Four things here are counter-intuitive

Each cost a debugging session to learn and each would have produced a *silently
broken gate* rather than an obvious one. They are commented in place; this is the
summary.

**1. Function breakpoints do not work on Node, and fail silently.**
The obvious design is `vscode.FunctionBreakpoint` — break on a function *name*,
which is robust to generated code where line numbers are unknowable. It cannot
work. js-debug ships `supportsFunctionBreakpoints: false` and does not implement
`setFunctionBreakpoints` at all. Worse, VS Code's debug service guards the send
on that capability, so the breakpoint is **discarded with no error surfaced to
the extension**. A probe built this way would report "breakpoint never hit" on
every run forever — a gate that can never pass, blaming the product. Hence glob +
regex resolution, which is the only option.

**2. `verified: false` does not mean the breakpoint is broken.**
js-debug answers `verified: false, message: "Unbound breakpoint"` at set time
because the script has not loaded yet, then rebinds later via a `breakpoint`
event rather than a fresh `setBreakpoints` response. On the known-good fixture
the breakpoint reports unverified and is hit a moment later. Gating on
`verified === true` — the obvious check, and what the DAP field appears to be
*for* — produces a gate that can never pass. It is recorded as a diagnostic and
nothing more.

**Do not gate on `verified`. Gate on the `stopped` event.** This is not a local
quirk: it reproduced in all five MSBench container runs. From
[`2026082623215161`](https://msbenchapp.azurewebsites.net/run-analysis/2026082623215161):

```
06:30:00.999  setBreakpoints response: [{"verified":false,"message":"Unbound breakpoint"}]
06:30:01.074  startDebugging returned true
06:30:01.581  trigger connected after 2 attempt(s)
06:30:01.589  stopped: reason=breakpoint     ← hit, 0.6s after being called unverified
```

The failure this avoids is the expensive kind: an intermittent **red against a
working project**, which reads as a product regression and gets explained away
as flaky agent output rather than investigated.

**3. The trigger request never completes on a healthy run.**
We break *mid-request*, so the HTTP response never arrives. The signal is
**socket connected**, not response received. Awaiting the response times out
against a working app and reports `appFailedToStart`.

**4. Silence is a harness fault, not a product failure.**
Workspace Trust blocks extension activation outright and its only symptom is an
absent verdict file. The probe therefore writes `.eval/probe.log` the instant it
activates, so "never activated" and "activated then stalled" can be told apart,
and the grader treats a missing verdict as exit 3. Run VS Code with
`--disable-workspace-trust`, or pre-trust the workspace.

## The verdict discriminates six outcomes, not two

Collapsing them is the failure mode this gate exists to avoid. `evals/src/gateHealth.ts`
documents a gate that went 0-for-16 across every run ever executed because its
probe signed requests with a corrupted key: no generated app could have passed,
and ten percent of the corpus was billed to a harness defect.

| Outcome | Meaning | Exit |
| --- | --- | --- |
| `hit` | execution reached the breakpoint | 0 |
| `launchConfigInvalid` | no `launch.json`, or no configuration by that name | 1 |
| `appFailedToStart` | the configuration ran but nothing came up | 1 |
| `breakpointNotHit` | the app was reachable, execution never arrived | 1 |
| `patternMatchedNothing` | the breakpoint could not be placed — **ambiguous** | 3 |
| `probeError` | the probe itself broke | 3 |

### Why `patternMatchedNothing` defaults to a harness fault

A pattern that matches nothing means either the agent did not produce what we
expected (product) or our pattern is wrong (harness). **From inside the probe
those are identical.** When a signal is ambiguous we blame ourselves, because the
errors are asymmetric: a harness fault miscounted as a product failure is
invisible and quietly poisons the corpus, while a product failure miscounted as a
harness fault is loud and gets investigated.

So it can be tightened later with data rather than argued about, the verdict
records `globMatchCount` and `filesMatchedByGlob` alongside the pattern. That
distinguishes *"no file matched `src/**/*.js`"* from *"found `src/server.js` but
no line matched `/health/`"* — very different diagnoses — without re-running
anything.

A stack whose contract genuinely guarantees the code exists can opt in per-stack:

```bash
node validate-debug-breakpoint.ts --pattern-miss-is-product-failure
```

## Certification

A gate that cannot fail is not a gate, so both directions are proven.

```bash
node certify.ts --offline     # 11 cases, no VS Code, ~2s — safe for CI
node certify.ts --live        # 7 cases, real VS Code + real js-debug
node certify.ts               # both
```

Useful flags: `--only=<case-id>`, `--verbose`, `--vscode=/path/to/code`.

**On Windows `code` is a `.cmd`**, which `spawnSync` cannot execute, so the live
tier resolves `Code.exe` instead — from whatever `code.cmd` is on PATH, then the
usual install locations. Before that it died with `spawnSync code ENOENT` before
a single case ran and reported it as seven identical *"probe did NOT activate"*
failures, which reads as a broken probe rather than a runner that never started
one. The live tier had therefore never been run on Windows at all. Resolution
happens only when the live tier is actually selected, so `--offline` still needs
no VS Code.

**Offline** synthesises verdict files and asserts the grader's exit code for
each, including the ones that must never blame the product: a missing verdict, a
malformed verdict, an unknown outcome, and a schema-version mismatch. This
certifies the part that assigns blame, so it runs anywhere.

**Live** stages the known-good fixture plus six mutations and runs real VS Code
against each. The load-bearing one is `mutation-breakpoint-unreachable`, which
puts the breakpoint on the `POST` 400 branch while triggering `GET /api/health`:
it must go red, and red for the right reason.

The fixture is [`evals/grader-certification/reference-node-fullstack`](../grader-certification/reference-node-fullstack),
reused as-is — it already ships `launch.json`, `tasks.json`, a health route and
zero dependencies. This directory only reads it.

## Wiring

The probe rides into a run as a second `installExtensions` entry in
[`msbench/config/base.yaml`](../msbench/config/base.yaml). That key
**concatenates across config layers rather than replacing**, which is how our
product VSIX already installs alongside `github.copilot-chat` — the probe is the
second user of that behaviour.

`run.sh` builds and stages `cor-debug-probe.vsix` next to the product VSIX, and
checks the package actually contains `out/extension.js`: a VSIX packaged without
compiling looks valid and then fails to activate, which from outside the
container is indistinguishable from not being installed at all.

The probe is **inert unless the workspace contains `debug-probe.json`**, so it is
installed on every run and opted into per stimulus. It watches for that file
rather than only reading it at activation, because whether the config's
`script:` preamble seeds the workspace before or after the extension host
finishes starting is not something we can verify from outside.

### The one claim that needs a real run

`evals/msbench/config/stimuli/debug-probe-smoke.yaml` is the smallest run that
answers the only part of this design that could not be settled locally: **does a
second extension install and activate alongside ours?** It uses a `probe-smoke`
phase with no `chatMode` and no agent seeding, so the agent does essentially
nothing — the evidence is written by the extension host before the first turn.
It asserts the liveness sentinel, that `.eval/probe.log` exists, and nothing
else. There is deliberately **no breakpoint assertion**: that is the next run,
gated on this one, because asserting it here would conflate "the probe installed"
with "the debugger works in a container" and a red result would not say which.

### Container notes

`pwa-node` needs no display (it drives CDP over a socket), but VS Code itself
does — use `xvfb`, and `--no-sandbox` since the container runs as root. Keep the
`--user-data-dir` path **short**: VS Code binds a Unix domain socket inside it
and `sun_path` caps at ~104 bytes. Exceeding it makes VS Code start, open no
window, write no logs, and hang until killed — indistinguishable from a broken
extension. `certify.ts` asserts against this explicitly rather than
rediscovering it. MSBench chooses that path, not us, so this is a hazard to
recognise rather than one we can configure away.

## Port squatters

A process that is not the project under test, holding a port the probe depends
on, is a **harness fault** — and one that would otherwise be reported as a
product failure with no sign of anything wrong:

- something on the **trigger port** serves the request instead of the app, so
  the breakpoint is never reached ⇒ `breakpointNotHit`, exit 1
- something on the **inspector port** stops node starting at all ⇒
  `appFailedToStart`, exit 1

Both are wrong, and both look completely ordinary. The probe therefore checks
both ports *before* launching and returns `probeError` if either is taken —
afterwards a squatter is indistinguishable from a broken project.

The check **connects** rather than binds. A bind test against `127.0.0.1`
reports a port free while a squatter holds `0.0.0.0` on macOS, which is exactly
how a stranger's process gets mistaken for the application. `certify.ts` proves
this with `mutation-port-squatted`, which holds `0.0.0.0:7071` from a separate
process and requires exit 3.

The inspector port matters more than it looks: `reference-node-fullstack` pins
`--inspect=9229`, and a pinned inspector port collides across concurrent runs
and survives a crashed earlier session. The probe cannot remap it — VS Code
reads `launch.json` directly and is only handed a configuration *name* — so
detecting and declining is the only honest option. Certification runs its cases
strictly sequentially for the same reason. A stack template emitting a hardcoded
inspector port should be fixed at the source rather than worked around here.

### Why certification runs sequentially

The live tier must not be parallelised. Its cases contend for two ports the
fixture **hardcodes** — `7071` via `env.PORT` and `9229` via
`runtimeArgs: ["--inspect=9229"]` — and the probe cannot remap either, because
VS Code reads `launch.json` directly and is handed only a configuration *name*.
Run two cases at once and the second finds a port held by the first. The port
guard turns that into `probeError` rather than a silent wrong answer, so it
fails loudly — but the suite would look broken instead of parallel. Making it
faster means fixing the hardcoded ports in the fixture, not removing the
sequencing. This is repeated as a comment on the loop in `certify.ts`, which is
where someone optimising for speed will actually be looking.

### One thing the probe does not do

It never binds or allocates a port — it only *connects* to two whose numbers it
is given. That matters because the allocation path is where this class of bug
tends to survive a fix: a free-port search that binds `127.0.0.1` can be handed
an ephemeral port a squatter already holds on `0.0.0.0`, and the caller then
latches onto the squatter believing it chose a free port. There is no such path
here by construction, and there should not be one added without the same
connect-based check.

## Measured in-container reliability

`debug-breakpoint-node` was run five times against the known-good fixture, from
an identical tree, to turn "it worked once" into a number.

| Run | Outcome | Trigger attempts | launch→connect | connect→stop | Total |
| --- | --- | --- | --- | --- | --- |
| [`2026082623215161`](https://msbenchapp.azurewebsites.net/run-analysis/2026082623215161) | `hit` | 2 | 0.507s | 8ms | 7.28s |
| [`2026082624051475`](https://msbenchapp.azurewebsites.net/run-analysis/2026082624051475) | `hit` | 2 | 0.512s | 6ms | 7.43s |
| [`2026082624376225`](https://msbenchapp.azurewebsites.net/run-analysis/2026082624376225) | `hit` | 2 | 0.507s | 6ms | 6.76s |
| [`2026082624660033`](https://msbenchapp.azurewebsites.net/run-analysis/2026082624660033) | `hit` | 2 | 0.516s | 6ms | 7.54s |
| [`2026082626667577`](https://msbenchapp.azurewebsites.net/run-analysis/2026082626667577) | `hit` | 2 | 0.509s | 5ms | 7.34s |

**5/5 `hit`.** js-debug launches a process, binds a breakpoint and stops on it
under xvfb-as-root on Ubuntu 22.04 with Node v22.22.2, reproducibly.

### The attempt count is a floor, not a ceiling

It is tempting to read "2 attempts every time" as a thin margin — one slow
container from needing 3, then 4, then failing. **That reading is wrong, and the
distribution shows why.** `launch→connect` is 0.507–0.516s across all five runs,
a 9ms spread, and `TRIGGER_RETRY_DELAY_MS` is 500ms. The app becomes ready
somewhere under 500ms after `startDebugging` returns, so attempt 1 always fires
too early and attempt 2 always succeeds. The 2 is a **property of the retry
interval**, not evidence of a near-miss.

Nothing caps the attempt count. The loop retries until the probe's deadline, so
a slower container spends more attempts rather than failing. The margin that
actually matters is **time-to-listen (~0.5s) against the probe budget (180s)** —
roughly 350×. A container would have to be two orders of magnitude slower before
this turned red, and if it were, the verdict would say `appFailedToStart` with
the debuggee's own output attached.

The number worth watching in future runs is therefore `launch→connect`, not the
attempt count.

### What this does and does not establish

It establishes that **the container can host a debugger** — which is what the
fixture is for. It says nothing about whether any particular generated project
is debuggable; that is the gate's job once it runs behind real output, and it is
only meaningful *because* this baseline exists. A red there can now be read as a
product finding rather than an unexplained one.

## Which stacks this gate can honestly answer for

**It requires a stack whose debug adapter ships with VS Code** — in practice the
Node family, via the built-in js-debug. That is a real constraint, not a
preference, and wiring it unconditionally produces exactly the failure this gate
was built to prevent.

Two directions, both verified rather than reasoned about:

**A launch configuration naming an adapter we do not install used to produce a
fabricated red.** `debugpy`, `go` and `coreclr` are not in this container. With
one of those, `startDebugging` never resolves, the probe hits its deadline and
the verdict was `appFailedToStart` — **exit 1, blaming the product for a project
it built correctly**, since that configuration would work on a developer machine
with the extension installed. Reproduced by setting `type: "debugpy"` on the
known-good fixture; the verdict even misattributed the cause to "an unfinishable
preLaunchTask". The probe now checks `contributes.debuggers[].type` across
installed extensions before launching and returns `probeError` (exit 3) naming
the missing adapter and listing the ones available. Certified by
`mutation-debug-adapter-missing`.

**With no `debug-probe.json`, the gate reports exit 3 forever.** The probe idles,
no verdict is written, and the grader correctly calls that a harness fault. But
MSBench collapses exit 1 and exit 3 into "non-zero", so on any stimulus that does
not opt in, a `requires: {}` wiring shows a permanently failing assertion. That
is the "gate that cannot pass" shape displaced into the exit-3 column.

So the gate should be wired where the stimulus writes a probe spec **and** the
stack is one the harness can drive. Everywhere else it is an environment gap: it
has a real question and no way to ask it, which is a `knownGap`, not a red.
