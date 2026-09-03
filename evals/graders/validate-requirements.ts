/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades `.azure/requirements.json` against the certified requirements validator.
 *
 * Schema and contract checks live in `evals/src/artifacts/requirements.ts` (shared
 * with grader certification). Only scenario-specific expectations are expressed here.
 *
 * Flags: --assert-no-frontend, --assert-blob-storage, --assert-cosmosdb,
 *        --assert-no-datastore, --assert-service-count=N,
 *        --assert-datastore-includes=<substring>, --assert-auth-includes=<substring>
 */

import { parseRequirementsJson } from '../../src/webviews/copilotOnRails/views/utils/parseRequirements.ts';
import { validateRequirementsArtifact } from '../src/artifacts/requirements.ts';
import { fail, failWithIssues, readArtifact, runGrader } from './graderHarness.ts';

runGrader('requirements.json satisfies the requirements contract', () => {
    const flags = new Set(process.argv.slice(2));
    const content = readArtifact('.azure/requirements.json');

    const result = validateRequirementsArtifact(content);
    if (!result.valid) {
        failWithIssues('requirements validation errors:', result.issues);
    }

    const requirements = parseRequirementsJson(content);
    const dataStores = requirements.questions.find(question => question.id === 'dataStores');
    const recommended = toArray(dataStores?.recommendedChoice);

    if (flags.has('--assert-no-frontend') && requirements.services?.some(service => service.role === 'frontend')) {
        fail('Expected no frontend service but found one');
    }
    if (flags.has('--assert-blob-storage') && !recommended.some(choice => choice.includes('Blob'))) {
        fail(`Expected Blob Storage in dataStores recommendedChoice, got: ${describe(recommended)}`);
    }
    if (flags.has('--assert-cosmosdb') && !recommended.some(choice => choice.includes('Cosmos'))) {
        fail(`Expected CosmosDB in dataStores recommendedChoice, got: ${describe(recommended)}`);
    }
    if (flags.has('--assert-no-datastore')) {
        if (!recommended.includes('No datastore required')) {
            fail(`Expected "No datastore required" in recommendedChoice, got: ${describe(recommended)}`);
        }
        if (recommended.length > 1) {
            fail(`"No datastore required" must not be combined with other stores, got: ${describe(recommended)}`);
        }
    }

    // Generalises the two hard-coded store flags above. Cosmos and Blob each earned a
    // dedicated flag before there was a second scenario needing a third store; adding
    // MySQL or Redis the same way would be a flag per store forever. Substring rather
    // than equality because recommendedChoice carries product names ("Azure Database
    // for MySQL - Flexible Server"), and a stimulus should be able to say "MySQL"
    // without pinning the exact marketing string, which changes independently of the
    // behaviour under test.
    const datastoreFlag = [...flags].find(flag => flag.startsWith('--assert-datastore-includes='));
    if (datastoreFlag) {
        const needle = datastoreFlag.slice('--assert-datastore-includes='.length);
        if (!needle) {
            throw new Error(`Invalid ${datastoreFlag}: expected a non-empty substring`);
        }
        if (!recommended.some(choice => choice.toLowerCase().includes(needle.toLowerCase()))) {
            fail(`Expected a datastore matching "${needle}" in recommendedChoice, got: ${describe(recommended)}`);
        }
    }

    // The shared `auth` question is mandatory in every valid artifact — the validator
    // raises `missingAuth` without it — but no scenario in this repo has ever answered
    // it with anything but "No auth", so the whole identity path was untested. Substring
    // for the same reason as datastores: "Microsoft Entra ID" and "Microsoft Entra
    // External ID" are both defensible for a given prompt, and a stimulus should be able
    // to say "Entra" without adjudicating workforce-versus-external identity.
    const authFlag = [...flags].find(flag => flag.startsWith('--assert-auth-includes='));
    if (authFlag) {
        const needle = authFlag.slice('--assert-auth-includes='.length);
        if (!needle) {
            throw new Error(`Invalid ${authFlag}: expected a non-empty substring`);
        }
        const auth = requirements.questions.find(question => question.id === 'auth' && !question.serviceId);
        const authChoice = toArray(auth?.recommendedChoice);
        if (!authChoice.some(choice => choice.toLowerCase().includes(needle.toLowerCase()))) {
            fail(`Expected an auth choice matching "${needle}", got: ${describe(authChoice)}`);
        }
    }

    const serviceCountFlag = [...flags].find(flag => flag.startsWith('--assert-service-count='));
    if (serviceCountFlag) {
        const expected = Number(serviceCountFlag.split('=')[1]);
        if (!Number.isInteger(expected) || expected < 0) {
            // A bad flag is a miswired eval spec, not a product defect. Throwing a
            // plain Error routes it to exit 3 so the report blames the harness.
            throw new Error(`Invalid ${serviceCountFlag}: expected a non-negative integer`);
        }
        const actual = requirements.services?.length ?? 0;
        if (actual !== expected) {
            fail(`Expected ${expected} services, got ${actual}`);
        }
    }
});

function toArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === 'string');
    }
    return typeof value === 'string' ? [value] : [];
}

function describe(choices: string[]): string {
    return choices.length ? choices.join(', ') : '(none)';
}
