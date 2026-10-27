/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades the claim no file can make on the application's behalf: it starts.
 *
 * `validate-project-builds` proves the project compiles. A project that compiles cleanly
 * and throws on the first line of its entry point passes that gate, passes every artifact
 * validator, and is completely broken — which is precisely the gap this closes.
 */

import { validateAppStarts } from '../src/runtime/runtimeGates.ts';
import { runRuntimeGate } from './runtimeGate.ts';

runRuntimeGate('runtime-app-starts', 'the scaffolded app starts and listens', validateAppStarts);
