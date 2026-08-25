/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades the generated `.vscode/launch.json` and `.vscode/tasks.json` for structural
 * soundness: named configurations, resolvable `preLaunchTask` and `dependsOn` chains,
 * terminating dependency graphs, and compounds that start each service exactly once.
 *
 * These are the defects a user hits on the first F5, and they are all detectable
 * without running anything.
 *
 * Flags: --assert-compound, --assert-no-compound, --assert-config-count=N
 */

import { existsSync } from 'node:fs';
import { readLaunchDocument, validateDebugLaunchConfiguration } from '../src/artifacts/launchConfig.ts';
import { fail, failWithIssues, readArtifact, runGrader, workspacePath } from './graderHarness.ts';

runGrader('launch.json and tasks.json are structurally sound', () => {
    const args = process.argv.slice(2);
    const launchText = readArtifact('.vscode/launch.json');
    // A workspace whose configurations declare no preLaunchTask legitimately has no
    // tasks file; the validator reports a dangling reference if one is needed.
    const tasksText = existsSync(workspacePath('.vscode/tasks.json')) ? readArtifact('.vscode/tasks.json') : undefined;

    const result = validateDebugLaunchConfiguration(launchText, tasksText);
    if (!result.valid) {
        failWithIssues('debug configuration errors:', result.issues);
    }

    const launch = readLaunchDocument(launchText);
    if (args.includes('--assert-compound') && launch.compounds.length === 0) {
        fail('Expected a compound configuration for a multi-service project, found none');
    }
    if (args.includes('--assert-no-compound') && launch.compounds.length > 0) {
        fail(`Expected no compound configuration for a single-service project, found ${launch.compounds.length}`);
    }

    const countFlag = args.find(arg => arg.startsWith('--assert-config-count='));
    if (countFlag) {
        const expected = Number(countFlag.split('=')[1]);
        if (!Number.isInteger(expected) || expected < 0) {
            // A bad flag is a miswired eval spec, not a product defect.
            throw new Error(`Invalid ${countFlag}: expected a non-negative integer`);
        }
        if (launch.configurations.length !== expected) {
            fail(`Expected ${expected} launch configurations, got ${launch.configurations.length}`);
        }
    }
});
