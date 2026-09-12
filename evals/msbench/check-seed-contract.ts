/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Fails when the seed a run would stage is not a document the planner's own contract accepts.
 *
 * ## The gap this closes
 *
 * Four stimuli -- `scaffold-fullstack`, `scaffold-autopilot`, `debug-plan-approval-gate` and
 * `debug-generate-artifacts` -- begin from a single seeded plan. That plan stands in for
 * `azure-project-plan`'s output, and it drifted away from the template the planner actually
 * emits: it had no per-service sections, its Prerequisites was a bullet list rather than the
 * `### Run` / `### Debug` tables, and it was missing `## 9. Next Steps` entirely. It failed
 * `validate-project-plan` outright, and had been failing for months.
 *
 * Nothing noticed, because nothing had ever pointed a grader at the seed. `npm run certify`
 * covers the grader-certification fixtures; `npm run drift` covers `resources/agents/**`. The
 * document *between* them -- a checked-in fixture standing in for agent output -- was covered
 * by neither.
 *
 * ## Why this shape rather than a hash
 *
 * The obvious guard is to record the `agentAssetsHash` a fixture was captured under and fail
 * when the lock moves, which is what `seeds/provenance.json` does for a *harvested* seed. That
 * is the wrong instrument for a checked-in fixture. Most agent-asset edits do not change the
 * plan template, so the check would fire constantly for reasons that are not defects, and a
 * check that cries wolf gets its hash bumped reflexively -- at which point it guards nothing.
 *
 * Running the production validator asks the question that actually matters, and it is the
 * question that was silently answered "no": *is this still a document the planner could have
 * emitted?* It fires exactly when the answer changes, and it fires for a reason a reader can
 * act on, because the validator names the missing section.
 *
 * ## Scope
 *
 * Structural conformance only. This cannot detect a plan that is well-formed but describes a
 * stack no planner would choose -- for that, `harvest-seed.ts --check` and a real harvest
 * remain the answer. What it guarantees is the floor: the seed is shaped like the planner's
 * output, so a scaffold run that fails is failing about the product.
 *
 * Runs straight off source via Node's built-in type stripping -- no build step.
 */

import { validateProjectPlanArtifact } from '../src/artifacts/projectPlan.ts';
import { planSeedDocuments } from './stage-workspace.ts';

function main(): void {
    let failures = 0;

    // Both recipes, not just one. They differ only in the `**Status**:` line, and that line is
    // exactly what `--expect-status` reads -- so validating one says nothing about the other's
    // status rewrite having produced a value the contract accepts.
    for (const { seed, status, content, source } of planSeedDocuments()) {
        const result = validateProjectPlanArtifact(content, { expectedStatus: status });
        const origin = source.harvested ? 'harvested seed' : 'checked-in fixture';

        if (result.valid) {
            console.log(`  ✔ ${seed.padEnd(20)} conforms (${origin}, status ${status})`);
            continue;
        }

        failures++;
        console.error(`  ✖ ${seed} does not satisfy the project-plan contract (${origin}):`);
        for (const issue of result.issues) {
            console.error(`      [${issue.code}] ${issue.path}: ${issue.message}`);
        }
    }

    if (failures > 0) {
        console.error('');
        console.error(`${failures} seed recipe(s) stage a plan the planner would not emit.`);
        console.error('Every scaffold and local-dev stimulus starts from this document, so they are');
        console.error('all being seeded with input no agent produced. Fix the source plan --');
        console.error(`  ${planSeedDocuments()[0]!.source.path}`);
        console.error('-- or re-harvest it: npm run seed:harvest -- <plan-run-id>');
        process.exit(1);
    }

    console.log('seed contract: every seeded plan satisfies the contract the graders assert.');
}

main();
