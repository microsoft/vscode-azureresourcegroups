/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The models MSBench runs, and the proof that they are models the product supports.
 *
 * ## Why a narrowed set
 *
 * The product supports five model *families* (`supportedModelNames`). MSBench does
 * not sweep all of them: `promptSteps` feeds a single chat session, so one run per
 * stimulus is forced, and `config/stimuli/README-redteam.md` asks for the red-team
 * stimuli on every model swept. Cost is therefore per-model across the whole corpus
 * — eight red-team stimuli across five families would be forty runs for one pass.
 *
 * Two are enough when they are chosen to differ *in kind*: one GPT, one Claude. The
 * failures worth catching here are the ones that diverge between families — #1807 is
 * a live case where two models disagreed on a security prompt — and two revisions of
 * one family would cost the same while covering less. `assertOneModelPerFamily`
 * below is that intent written as a check rather than left as a convention.
 *
 * ## Exact ids here, families in the product
 *
 * `modelSelector.id` in `config/base.yaml` is half the CES queueing key and is sent
 * verbatim to the backend, so it must be an exact, dispatchable id. The product,
 * since #1845, no longer pins versions at all: it discovers whatever is available at
 * runtime and matches it to a family by name. The two layers therefore cannot share
 * a representation, and this file is where the exact ids live.
 *
 * ## What this can and cannot prove
 *
 * `getSupportedModelName` answers "is this a family the product ships?". It does
 * **not** answer "does this exact version exist?" — `claude-sonnet-4.5` matches the
 * `Sonnet` family and would pass every check in this file, and that is precisely the
 * id that was pinned here for 66 of the corpus's 93 runs before anyone noticed.
 *
 * Saying so plainly matters more than the check reading strong. The version half is
 * caught downstream instead, in two places that do not depend on a local list:
 *
 *   - at launch, where an unknown id hard-fails with `X_MODEL_NOT_FOUND_ERROR`
 *     before any agent turn and therefore costs nothing;
 *   - after the run, in `verify-run.ts`, which compares the model that *answered*
 *     against the model that was requested.
 *
 * A guard that overstated its reach would be worse than this one, because the gap
 * would be invisible rather than written down.
 */

import { getSupportedModelName, supportedModelNames } from '../../src/utils/copilotOnRails/modelSelection.ts';

/**
 * The sweep set. Exact ids, because this is what `modelSelector.id` is set to.
 *
 * `gpt-5.6-sol` is first because it is the `base.yaml` default. Both entries are
 * MEASURED to dispatch and pass, on 2026-09-15 against the current `feat/CoR` build:
 *
 *   gpt-5.6-sol      run 2026091484150789   8/8 assertions, identity verified
 *   claude-sonnet-5  run 2026091559194892   8/8 assertions, identity verified
 *
 * `claude-sonnet-4.6` was the Claude entry until that day and is NOT usable: it is
 * absent from the backend's catalogue and fails at launch with
 * `X_MODEL_NOT_FOUND_ERROR - Model not found in cached models: claude-sonnet-4.6`
 * (runs 2026090974671590 and 2026091558015441, measured nine days apart). Do not put
 * it back without re-measuring — nothing in this file can detect it, because it is a
 * real `Sonnet` and passes the family check below.
 */
const SWEEP_MODELS: readonly string[] = ['gpt-5.6-sol', 'claude-sonnet-5'];

/**
 * The sweep set, having proved each entry belongs to a family the product supports
 * and that no two entries share a family.
 *
 * Throws rather than filtering. Dropping an entry that fails the check would turn a
 * two-model sweep into a one-model sweep that still calls itself a sweep, which is
 * the same class of mislabelling the model checks exist to prevent.
 */
export function resolveSweepModels(): readonly string[] {
    const unsupported = SWEEP_MODELS.filter(id => getSupportedModelName(id) === undefined);
    if (unsupported.length > 0) {
        const subject = unsupported.length === 1 ? 'which matches' : 'none of which match';
        throw new Error(
            `MSBench sweep set names ${unsupported.map(id => `'${id}'`).join(', ')}, ${subject} a `
            + 'family the product supports.\n'
            + `  Supported families: ${supportedModelNames.join(', ')}\n`
            + `  Sweep set: ${SWEEP_MODELS.join(', ')}\n`
            + '  Families come from src/utils/copilotOnRails/modelSelection.ts, which is what the\n'
            + '  product itself matches against. Running a family the product does not ship\n'
            + '  measures a configuration no user can reach.\n'
            + '  Fix evals/msbench/models.ts, or add the family there if the product now ships it.',
        );
    }
    assertOneModelPerFamily();
    return SWEEP_MODELS;
}

/**
 * Two entries from one family would double the cost of every sweep while leaving the
 * other family uncovered — the specific mistake this set exists to prevent, and one
 * that looks perfectly reasonable in a diff.
 */
function assertOneModelPerFamily(): void {
    const byFamily = new Map<string, string[]>();
    for (const id of SWEEP_MODELS) {
        const family = getSupportedModelName(id);
        if (family === undefined) {
            continue;
        }
        byFamily.set(family, [...byFamily.get(family) ?? [], id]);
    }
    const duplicated = [...byFamily.entries()].filter(([, ids]) => ids.length > 1);
    if (duplicated.length > 0) {
        throw new Error(
            'MSBench sweep set covers one family twice: '
            + duplicated.map(([family, ids]) => `${family} (${ids.join(', ')})`).join('; ')
            + '.\n  The set is deliberately one model per family, because the divergences worth\n'
            + '  catching are between families rather than between revisions of one. Two entries\n'
            + '  from a single family double the cost of every sweep and cover less.',
        );
    }
}
