/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades whether the datastore the scaffold actually wires is the one the plan chose.
 *
 * This is the fidelity failure nothing else can see: a project that plans PostgreSQL and
 * wires SQLite installs, builds, starts and passes every other gate in the suite.
 *
 * The contract lives in `evals/src/artifacts/datastoreFidelity.ts`, shared with grader
 * certification, so the certified path and the executed path cannot drift.
 *
 * On a stack with no dependency analyser this reports **not-applicable**, never a pass —
 * a datastore check that silently approves every Go project is indistinguishable from no
 * check at all. That verdict exits 3 and carries a `NOT_APPLICABLE` marker naming the gap;
 * see `NOT_APPLICABLE_EXIT_CODE` in the harness for why red-and-explained beats green.
 */

import { DATASTORE_NOT_APPLICABLE_CODES, validateDatastoreFidelity } from '../src/artifacts/datastoreFidelity.ts';
import { failWithIssues, gateId, readArtifact, runGraderAsync, skipAsNotApplicable, workspacePath } from './graderHarness.ts';

void runGraderAsync('the wired datastore matches the one the plan chose', async () => {
    const planMarkdown = readArtifact('.azure/project-plan.md');
    const result = await validateDatastoreFidelity(workspacePath('.'), planMarkdown);
    if (result.valid) {
        return;
    }

    const blocking = result.issues.filter(value => !(value.code in DATASTORE_NOT_APPLICABLE_CODES));
    if (blocking.length === 0) {
        const skipped = result.issues[0];
        skipAsNotApplicable(gateId(), DATASTORE_NOT_APPLICABLE_CODES[skipped.code], skipped.code, skipped.message);
    }
    failWithIssues('datastore fidelity errors:', blocking);
});
