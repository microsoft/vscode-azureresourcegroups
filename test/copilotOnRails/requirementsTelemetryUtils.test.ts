/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { getRequirementsTelemetry, REQUIREMENTS_TELEMETRY_PREFIX, RequirementsTelemetry } from '../../src/webviews/copilotOnRails/extension/utils/requirementsTelemetryUtils';
import { parseRequirementsJson, type RequirementsData } from '../../src/webviews/copilotOnRails/views/utils/parseRequirements';
import { getWorkspaceFolderUri } from '../testUtils';

export const scrapbookProjectFolder = 'copilotOnRails-scrapbook';
export const attendanceProjectFolder = 'copilotOnRails-attendance';

suite('requirementsTelemetryUtils', () => {
    suite('getRequirementsTelemetry', () => {
        test('attendance project', () => {
            const telemetry = loadRequirementsTelemetry(attendanceProjectFolder);

            const expected: RequirementsTelemetry = {
                parsedOk: true,
                schemaVersion: '2',
                mode: 'new',
                executionMode: 'guided',

                serviceCount: 2,
                serviceRoles: 'backend,frontend',

                questionCount: 7,
                confirmedCount: 7,
                needsInputCount: 0,
                inferredCount: 0,

                questionCategories: 'auth,data,service',

                serviceLanguages: 'typescript',
                serviceFrameworks: 'react + vite',

                dataStores: 'blob storage,postgresql',
                hasDatabase: true,

                auth: 'microsoft entra id',
            };

            assert.deepStrictEqual(telemetry, expected);
        });

        test('scrapbook project', () => {
            const telemetry = loadRequirementsTelemetry(scrapbookProjectFolder);

            const expected: RequirementsTelemetry = {
                parsedOk: true,
                schemaVersion: '2',
                mode: 'new',
                executionMode: 'guided',

                serviceCount: 3,
                serviceRoles: 'backend,frontend,worker',

                questionCount: 9,
                confirmedCount: 9,
                needsInputCount: 0,
                inferredCount: 0,

                questionCategories: 'auth,data,service',

                serviceLanguages: 'typescript',
                serviceFrameworks: 'react + vite',

                dataStores: 'blob storage,postgresql',
                hasDatabase: true,

                auth: 'mock auth middleware',
            };

            assert.deepStrictEqual(telemetry, expected);
        });

        test('empty data yields safe defaults', () => {
            const telemetry = getRequirementsTelemetry({ questions: [] });

            assert.strictEqual(telemetry.parsedOk, true);
            assert.strictEqual(telemetry.schemaVersion, 'unknown');
            assert.strictEqual(telemetry.mode, 'unknown');
            assert.strictEqual(telemetry.executionMode, 'unknown');
            assert.strictEqual(telemetry.serviceCount, 0);
            assert.strictEqual(telemetry.serviceRoles, '');
            assert.strictEqual(telemetry.questionCount, 0);
            assert.strictEqual(telemetry.confirmedCount, 0);
            assert.strictEqual(telemetry.questionCategories, '');
            assert.strictEqual(telemetry.serviceLanguages, '');
            assert.strictEqual(telemetry.serviceFrameworks, '');
            assert.strictEqual(telemetry.dataStores, '');
            assert.strictEqual(telemetry.hasDatabase, false);
            assert.strictEqual(telemetry.auth, 'none');
        });

        test('reports parse errors via parsedOk', () => {
            const telemetry = getRequirementsTelemetry({
                questions: [],
                parseError: { message: 'could not parse' },
            });

            assert.strictEqual(telemetry.parsedOk, false);
        });

        test('detects database from data stores', () => {
            const data: RequirementsData = {
                questions: [
                    {
                        id: 'dataStores',
                        category: 'data',
                        question: 'Which data stores?',
                        answer: ['CosmosDB'],
                        status: 'confirmed',
                    },
                ],
            };

            const telemetry = getRequirementsTelemetry(data);
            assert.strictEqual(telemetry.hasDatabase, true);
            assert.strictEqual(telemetry.dataStores, 'cosmosdb');
        });

        test('handles no auth question gracefully', () => {
            const data: RequirementsData = {
                questions: [
                    {
                        id: 'someOther',
                        category: 'service',
                        question: 'Something?',
                        answer: 'yes',
                        status: 'confirmed',
                    },
                ],
            };

            const telemetry = getRequirementsTelemetry(data);
            assert.strictEqual(telemetry.auth, 'none');
        });

        test('exposes a namespaced telemetry prefix', () => {
            assert.strictEqual(REQUIREMENTS_TELEMETRY_PREFIX, 'requirements.');
        });
    });
});

function loadRequirementsTelemetry(workspaceFolderName: string): RequirementsTelemetry {
    const fixtureUri = Uri.joinPath(getWorkspaceFolderUri(workspaceFolderName), 'requirements.json');
    const json = fs.readFileSync(fixtureUri.fsPath, 'utf8');
    return getRequirementsTelemetry(parseRequirementsJson(json));
}
