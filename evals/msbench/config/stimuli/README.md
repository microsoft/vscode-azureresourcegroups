# Stimuli

One config file per stimulus. `build-config.ts <name>` concatenates
`../base.yaml` + `../phases/<phase>.yaml` + `<name>.yaml` into
`../../assets/user-overrides.yaml`; `stage-workspace.ts <name>` materialises the
starting workspace the stimulus declares. Both are driven by header directives:

| Directive | Default | Resolved by | Selects |
| --- | --- | --- | --- |
| `# phase: <name>` | `plan` | `build-config.ts` | `chatMode`, `snapshotWorkspace`, the seeding `script:` |
| `# seed: <name>` | `none` | `stage-workspace.ts` | the workspace state before turn 0 |

See [`../../README.md`](../../README.md) for everything else — the layering, the
assertion rules, and the liveness sentinel every step carries.

**None of the scaffold or local-dev stimuli here has ever been run on MSBench.**
They are wired against graders certified offline against hand-authored fixtures.
Certification proves a grader agrees with a fixture; it says nothing about
whether the stimulus elicits the behaviour the grader is looking for.

## Falsifiable pairs

Two pairs are load-bearing and are the reason four scaffold stimuli exist rather
than two. In each pair the two files differ in exactly one thing:

| Pair | The single difference | What it discriminates |
| --- | --- | --- |
| `scaffold-fullstack` / `scaffold-autopilot` | the `[AUTOPILOT MODE]` prompt prefix | opens the UI approval gate vs. skips it and hands off |
| `scaffold-fullstack` / `scaffold-unapproved-plan` | the plan's `**Status**` line | scaffolds vs. refuses |

An agent that *always* opens the approval gate fails exactly one member of each
pair; one that *never* does fails exactly the other. No degenerate strategy
passes both, which is what makes a green result evidence rather than a
coincidence — and is a property no single stimulus can have.

Any second difference destroys it. `harvest-seed.mjs` (commit `cc75a4e1`, not on
`feat/CoR`) put the sharp version of the claim:

> `approved-fullstack` and `unapproved-plan` deliberately come from the *same*
> run: the pair is only falsifiable if the sole difference is the approval
> status, so the scaffold agent cannot pass both by keying off anything else in
> the document.

`stage-workspace.ts` preserves that by deriving the unapproved seed from the
approved one in code, and asserting the status line was found — two checked-in
documents would drift in a second dimension the first time either was edited.

**If you edit one file of a pair, edit both or neither.**

## Deliberately missing: `scaffold-api-only`

There is no stimulus for the API-only scaffold shape, and the gap is recorded
here rather than only in the pull request, because an undocumented gap silently
becomes a claim of coverage.

**Why it is missing.** The shape needs a plan with no frontend. Neither
checked-in plan is API-only: `evals/local-dev/fixtures/functions-postgres/` is
fullstack, and it is the only real plan in the tree. Authoring one by hand means
writing a project plan no planner ever emitted — which is worse than a stale
harvested one, and indefensible in a suite whose entire selling point is that it
grades real agent output. So it is left out rather than faked.

**The unblock is one run.** This is a missing seed run, not a missing design.
`harvest-seed.mjs` (commit `cc75a4e1`) already had `api-only` as a first-class
target alongside `fullstack`:

```
node evals/msbench/harvest-seed.mjs --run-id <id> --target api-only
```

with a `TARGETS` entry of `{ name: "approved-api-only", status: "Approved" }`.
Concretely: put the existing `api-only-inventory` requirements through the plan
phase, harvest a genuine plan from the resulting run, add an `approved-api-only`
recipe to `stage-workspace.ts`, and the stimulus is a copy of
`scaffold-fullstack.yaml` with `--has-frontend` and `--require-frontend` dropped.

**The specific blind spot until then.** There is no scaffold coverage for the
no-frontend shape. A scaffolder that invents a frontend for an API-only project —
building a React app nobody asked for, and opening a UI approval gate for a
project with no UI — would not be caught by anything in this directory. Both
shipped fullstack stimuli assert a frontend is present, so they would pass such
an agent, and both refusal stimuli assert nothing was built at all.

Note also that this is the one shape where `validate-project-builds` is the
*only* evidence the agent emitted a working project — that grader's own header
says so, because the artifact validators have nothing frontend-shaped to inspect.

## What the checked-in seed gives up

`stage-workspace.ts` derives its seeds from a checked-in fixture. That is the
option `harvest-seed.mjs` was written to avoid, and the objection is real:

> Checking one in makes that document a second source of truth: edit the
> planner's template and the stored copy still describes the old shape, so the
> scaffold graders keep passing against a plan no agent would emit.

What bounds it is that grader's companion property, from the same header:

> It is an *input, not an expected answer*. No scaffold grader reads the plan --
> they assert against `resources/agents/**`. A wrong plan therefore makes
> scaffold trials fail loudly; it cannot make them pass wrongly.

So the drift is **fail-safe, not fail-open**: a stale plan makes real runs go red
for a bad reason — expensive and confusing — but cannot make a broken scaffolder
look green. The risk is accepted knowingly, not argued away.

The concrete thing lost is the drift control: `harvest-seed.mjs` had a `--check`
mode that reported seed freshness and exited 1 when the seed was stale, hashed
against `resources/agents/**`. The checked-in fixture has no equivalent, so
nothing detects that drift automatically. `npm run drift` in `evals/` covers the
agent contracts themselves, not the fixture's agreement with them.
