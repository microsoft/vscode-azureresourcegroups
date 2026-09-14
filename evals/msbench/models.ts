/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The models MSBench is allowed to run, and the proof that they are real.
 *
 * ## Why this is narrower than the agent frontmatter
 *
 * `resources/agents/*.agent.md` declare four models, because that is what the
 * product ships and a user can pick. MSBench does not sweep all four: every
 * additional model multiplies the run count of a suite that is already measured in
 * hours and paid capacity, and `README-redteam.md` asks for the red-team stimuli on
 * *every* model that is swept, so the cost is per-model across the whole corpus.
 *
 * Two are deliberately enough, chosen to be different in kind rather than in
 * version — one GPT and one Claude. The failures worth catching here are the ones
 * that differ between model families (issue #1807 is a live case where two models
 * disagreed on a security prompt); two revisions of the same family would cost the
 * same and cover less.
 *
 * ## Why it is a subset, checked rather than asserted
 *
 * A list of model ids maintained next to the one in the agent frontmatter is how
 * `base.yaml` came to pin `claude-sonnet-4.5` — an id no agent declares and
 * `MODEL_DISPLAY_NAME_TO_ID` does not map — for 66 of the corpus's 93 runs, with
 * nothing reporting it until the id dropped out of the CES catalogue and the suite
 * stopped dead with `X_MODEL_NOT_FOUND_ERROR`.
 *
 * So this list is never used without being proved a subset of what the agents
 * declare: `resolveSweepModels` is the only export that yields it, and it throws
 * rather than returning an unchecked list. Narrowing is legitimate; inventing is
 * not, and the difference is exactly the subset test.
 */

import { readSupportedModels } from '../src/agent-definition.ts';

/**
 * All six agents ship the same `model:` list and `check-agent-drift.ts` fails if
 * they diverge, so any one of them answers "what does the product declare".
 */
const REFERENCE_AGENT = 'azure-project-plan';

/**
 * The sweep set. Ids, not display names — this is what goes in `modelSelector.id`.
 *
 * `gpt-5.6-sol` is first because it is the default in `config/base.yaml`, and it is
 * the default because it is the one of the two measured to dispatch: it is absent
 * from the shipped `COPILOT_VENDOR_MODELS` catalogue yet resolves and runs (see
 * README.md, "Model verification"), whereas `claude-sonnet-4.6` failed outright with
 * `X_MODEL_NOT_FOUND_ERROR - Model not found in cached models: claude-sonnet-4.6`
 * on run `2026090974671590` (2026-09-09).
 *
 * `claude-sonnet-4.6` is kept in the set regardless, because the set answers "what
 * should be swept", not "what is up right now" — a backend outage is not a reason to
 * quietly stop covering a model family. Re-test it before relying on a Claude
 * datapoint; passing the subset check below says the product declares it, and
 * nothing about whether the backend can currently serve it.
 */
const SWEEP_MODELS: readonly string[] = ['gpt-5.6-sol', 'claude-sonnet-4.6'];

/**
 * The sweep set, having proved every entry is a model the product declares.
 *
 * Throws instead of filtering. Silently dropping an entry that no agent declares
 * would turn a two-model sweep into a one-model sweep that still calls itself a
 * sweep, which is the same class of mislabelling the model checks exist to prevent.
 *
 * @param repoRoot Repository root, for locating `resources/agents`.
 */
export function resolveSweepModels(repoRoot: string): readonly string[] {
    const declared = readSupportedModels(repoRoot, REFERENCE_AGENT);
    const undeclared = SWEEP_MODELS.filter(id => !declared.includes(id));
    if (undeclared.length > 0) {
        throw new Error(
            `MSBench sweep set names ${undeclared.map(id => `'${id}'`).join(', ')}, `
            + `which ${REFERENCE_AGENT}.agent.md does not declare.\n`
            + `  Declared: ${declared.join(', ')}\n`
            + `  Sweep set: ${SWEEP_MODELS.join(', ')}\n`
            + '  The sweep set must be a subset of the shipped models: a run on an\n'
            + '  undeclared model measures a configuration no user can reach.\n'
            + '  Fix evals/msbench/models.ts, or add the model to every agent\'s\n'
            + '  `model:` frontmatter if the product really does ship it.',
        );
    }
    return SWEEP_MODELS;
}
