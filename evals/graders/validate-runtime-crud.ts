/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades the data layer by using it: write a record, read it back.
 *
 * This is what separates a working persistence layer from a well-typed stub — a handler
 * that validates its input, returns 201 and stores nothing type-checks, builds, starts,
 * serves a health endpoint and satisfies every other gate in this repository.
 *
 * The eval container has no Docker and cannot practically get it, so a project whose
 * datastore needs a database server reports not-applicable rather than passing. A silent
 * pass on a stack that cannot be exercised is a gate that has quietly stopped testing
 * anything, which is worse than not having the gate.
 */

import { validateCrudRoundTrip } from '../src/runtime/runtimeGates.ts';
import { runRuntimeGate } from './runtimeGate.ts';

runRuntimeGate('runtime-crud', 'a CRUD round-trip persists', validateCrudRoundTrip);
