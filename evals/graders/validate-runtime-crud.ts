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
 * A project whose datastore needs a database server reports not-applicable rather than
 * passing when nothing is listening on that datastore's port. A silent pass on a stack
 * that cannot be exercised is a gate that has quietly stopped testing anything, which is
 * worse than not having the gate.
 *
 * That stand-down used to fire on the datastore package name alone, because no Docker
 * meant no database. The custom image installs PostgreSQL and Azurite, neither of which
 * needs a container, and the phase preamble starts them — so the gate now probes the port
 * and only stands down when nothing answers.
 */

import { validateCrudRoundTrip } from '../src/runtime/runtimeGates.ts';
import { runRuntimeGate } from './runtimeGate.ts';

runRuntimeGate('runtime-crud', 'a CRUD round-trip persists', validateCrudRoundTrip);
