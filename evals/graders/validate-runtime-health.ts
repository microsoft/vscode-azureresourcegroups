/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades the most basic "it's alive" signal there is: the health endpoint answers.
 *
 * A health route is what every deployment probe in Azure depends on, and it is the first
 * thing a generated app is asked for after it boots. A route that exists in the source and
 * returns 500 at runtime is invisible to every file-reading gate we have.
 *
 * Flags:
 *   --require-health   fail, rather than report not-applicable, when no health endpoint is
 *                      found — for stimuli whose stack is known to promise one
 */

import { validateHealthEndpoint } from '../src/runtime/runtimeGates.ts';
import { runRuntimeGate } from './runtimeGate.ts';

const requireHealth = process.argv.includes('--require-health');

runRuntimeGate(
    'runtime-health',
    'the app answers its health endpoint',
    workspaceRoot => validateHealthEndpoint(workspaceRoot, { requireHealth }),
);
