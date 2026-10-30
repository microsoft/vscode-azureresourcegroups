---
description: 'Keep shipped Azure agent assets, offline graders, MSBench stimuli, and verified drift baselines synchronized.'
applyTo: "resources/agents/**, evals/**, .vally.yaml, .github/workflows/agent-contracts.yml, .github/workflows/msbench-evals.yml"
---

# Agent assets and evaluations

- `resources/agents` is the shipped source of agent manifests, phase instructions, and shared
  references. Change the source contract, then its corresponding stimuli/graders; do not preserve
  a removed product rule only in an eval copy.
- Follow `evals/check-agent-drift.ts`: it tracks agent manifests, agent directories, and shared
  references by default. `evals/agent-assets.lock.json` records a verified baseline, not a way to
  waive a failing contract. Re-run affected evaluations before refreshing it with
  `node evals/check-agent-drift.ts --update` from the root, and inspect the resulting lock diff.
- Keep eval-only dependencies in `evals/package.json` and its lockfile, not the extension manifest.
  The root TypeScript check excludes `evals`; run its own `typecheck`.
- Use `.github/workflows/agent-contracts.yml` as the list of credential-free contract gates. From
  `evals`, the existing commands include `npm run drift`, `npm run typecheck`, `npm run certify`,
  and `npm run lint`. Other focused gates include `imports:self-test`, `stacks:check`, `gates`,
  `phases:check`, and `seed:contract`. From the root, `npm run eval:tool-coverage` checks registered
  MCP tool coverage.
- `npm run lint` inside `evals` lints explicit Vally specs; bare `vally lint` at the root can
  discover no skills and pass without checking the intended specs. Root `npm run lint` is a
  different check: extension ESLint plus agent drift.
- Match assertions to evidence a phase can actually produce. Keep canonical shared SQL assertion
  comments stable: their text is gate identity, not prose to paraphrase. Use the `gates` and
  `phases:check` commands when changing stimuli.
- Test grader changes against both a valid fixture and one that should fail. Fixtures under
  `evals/grader-certification` deliberately contain unsupported or malformed inputs; do not
  "repair" them to satisfy extension lint or make a grader pass.
- Do not hand-edit staged/generated MSBench assets. `.gitignore` identifies generated graders,
  workspace/fixture copies, `user-overrides.yaml`, and `stack.json`; edit their owning source
  fixtures/configuration and use the staging/build path instead.
- Preserve clean-machine execution of MSBench scripts and the import-scanner constraints;
  container-staged graders must not silently depend on local `node_modules`. Use the applicable
  self-tests in `agent-contracts.yml`; `clean-machine:check` temporarily moves eval dependencies
  and should not run concurrently with other eval work.
- Live agent/MSBench runs are separate from offline contract checks and can consume credentials,
  budget, and real Azure resources. Do not launch them implicitly or describe offline certification
  as proof that a live agent completed the user journey.
