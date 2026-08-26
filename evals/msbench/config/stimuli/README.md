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

**Two of the six new stimuli have now been run; four have not.**
`scaffold-unapproved-plan` and `scaffold-missing-plan` are green on real runs —
see [Verified results](#verified-results). `scaffold-fullstack`,
`scaffold-autopilot`, `debug-plan-approval-gate` and `debug-generate-artifacts`
have never been run, and neither has the scaffold *happy path* in any form: both
verified runs are refusal cases, so **no run has yet graded a project the agent
actually built.** The four scaffold-quality graders
(`validate-frontend-scaffold`, `validate-integration-plan`,
`validate-project-builds`) remain wired but unexercised.

For those four, the original caveat stands: they are certified offline against
hand-authored fixtures, and certification proves a grader agrees with a fixture
while saying nothing about whether the stimulus elicits the behaviour the grader
is looking for.

## Falsifiable pairs

Two pairs are load-bearing and are the reason four scaffold stimuli exist rather
than two. The rule is about the **input**, not the expectations:

> In each pair, the two stimuli differ in exactly one thing about the *workspace
> and prompt the agent sees*. Their **assertions necessarily differ**, because
> the contracted correct behaviour differs — that is what makes the pair
> falsifiable rather than a tautology.

| Pair | The single input difference | Assertions, which differ by design |
| --- | --- | --- |
| `scaffold-fullstack` / `scaffold-autopilot` | the `[AUTOPILOT MODE]` prompt prefix | inverted: gate opened + no hand-off / gate skipped + hand-off |
| `scaffold-fullstack` / `scaffold-unapproved-plan` | the plan's `**Status**` line | disjoint: build-and-hand-off contract / refusal contract |

So the pairs are not two copies of one test. `scaffold-autopilot` asserts the
frontend preview gate was **not** opened, because
`azure-project-scaffold.agent.md` contracts autopilot to skip it; asserting the
same thing as `scaffold-fullstack` would be asserting product-*incorrect*
behaviour.

The discrimination that buys, stated explicitly:

- An agent that **always** opens the UI approval gate passes `scaffold-fullstack`
  and fails `scaffold-autopilot`.
- An agent that **never** opens it passes `scaffold-autopilot` and fails
  `scaffold-fullstack`.
- An agent that **always scaffolds** whatever the plan says passes
  `scaffold-fullstack` and fails `scaffold-unapproved-plan`; one that **always
  refuses** does the reverse.

No degenerate strategy passes both members of either pair, which is what makes a
green result evidence rather than a coincidence — and is a property no single
stimulus can have.

A second *input* difference destroys it. `harvest-seed.mjs` (commit `cc75a4e1`,
not on `feat/CoR`) put the sharp version of the claim:

> `approved-fullstack` and `unapproved-plan` deliberately come from the *same*
> run: the pair is only falsifiable if the sole difference is the approval
> status, so the scaffold agent cannot pass both by keying off anything else in
> the document.

`stage-workspace.ts` preserves that by deriving the unapproved seed from the
approved one in code, and asserting the status line was found — two checked-in
documents would drift in a second dimension the first time either was edited.

**If you edit one file of a pair, edit both or neither.**

## Run ordering

**Run `scaffold-unapproved-plan` before `scaffold-missing-plan`, and do not clear
`assets/workspace/` by hand in between.**

This is counter-intuitive, which is exactly why it is written down rather than
left to good judgement. The next person to run these will reasonably assume that
starting from a clean `assets/workspace/` is the careful thing to do. **That
assumption silently voids `scaffold-missing-plan`'s only test of the
seed-clear.**

The two failure modes are different and only one of them is covered by a check:

| Failure | Caught by |
| --- | --- |
| The seed-clear is **broken** | `scaffold-missing-plan`'s `test ! -f` precondition |
| The seed-clear is **untested** | nothing but the run ordering |

`stage-workspace.ts` clears `assets/workspace/` unconditionally before writing a
recipe, because `assets/` is shared mutable state reused across invocations. If
that clear ever stops working, a leftover plan turns `# seed: none` into a
weaker duplicate of `scaffold-unapproved-plan` — green, and testing nothing.
Running the seeded stimulus first leaves a plan on disk, so the unseeded run that
follows has something real to clear.

Observed working, not merely reasoned about: run `2026082619460117` ran
immediately after `2026082618693091` left an unapproved plan in
`assets/workspace/`, and its environment fingerprint reports
`ls: cannot access '.azure': No such file or directory` in the container.

## Verified results

The scaffold refusal gates have been run. Everything else in this directory has
not — see the note at the top.

| Stimulus | Run | Result |
| --- | --- | --- |
| `scaffold-unapproved-plan` | [`2026082618693091`](https://msbenchapp.azurewebsites.net/run-analysis/2026082618693091) | 6/6, `resolved: true` |
| `scaffold-missing-plan` | [`2026082619460117`](https://msbenchapp.azurewebsites.net/run-analysis/2026082619460117) | 7/7, `resolved: true` |

Both were checked past the assertion tally, because a refusal stimulus scoring
full marks is exactly what a dead run also looks like. In `2026082618693091` the
agent called `read_file` and refused naming `Status: Planning`; in
`2026082619460117` it called `read_file`, got a genuine not-found, called
`file_search`, and emitted the contracted refusal verbatim. Both are refusals for
the contracted reason rather than by luck.

`scaffold-missing-plan`'s run predates the `test ! -f` precondition above, so the
seed-clear was confirmed from its fingerprint rather than by that check. The
precondition exists so the next person does not have to read a fingerprint to
know.

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
