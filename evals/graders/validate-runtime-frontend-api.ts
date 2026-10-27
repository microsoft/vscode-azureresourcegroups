/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades whether the two halves of the generated app actually talk to each other.
 *
 * A frontend that builds, a backend that builds, and a frontend calling `/api/projects`
 * while the backend serves `/api/items` is a classic scaffolding failure — and it passes
 * every gate we have, including the build gate and the runtime gates above this one, since
 * each half is individually fine.
 *
 * The paths are taken from the *served* assets rather than the source tree, because what
 * the browser receives is what matters. Only a 404 fails: a 400, 405 or 500 all prove the
 * route exists, which is the question being asked here.
 */

import { validateFrontendApiWiring } from '../src/runtime/runtimeGates.ts';
import { runRuntimeGate } from './runtimeGate.ts';

runRuntimeGate('runtime-frontend-api', 'the frontend and backend are wired together', validateFrontendApiWiring);
