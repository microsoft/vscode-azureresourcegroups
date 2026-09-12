/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades whether the browser actually receives a document.
 *
 * `validate-frontend-scaffold` reads the frontend's configuration and `validate-project-builds`
 * builds it; neither asks whether anything is served. An app that builds a frontend it never
 * routes — or routes to a 404 — satisfies both.
 *
 * Scoped to frontends the application under test serves itself. A frontend behind its own
 * dev server is a second process with its own install and readiness signal, and reports
 * not-applicable until these gates learn to start one.
 *
 * Flags:
 *   --require-frontend   probe / even when no index.html was found in the workspace
 */

import { validateFrontendServes } from '../src/runtime/runtimeGates.ts';
import { runRuntimeGate } from './runtimeGate.ts';

const requireFrontend = process.argv.includes('--require-frontend');

runRuntimeGate(
    'runtime-frontend',
    'the app serves its frontend',
    workspaceRoot => validateFrontendServes(workspaceRoot, { requireFrontend }),
);
