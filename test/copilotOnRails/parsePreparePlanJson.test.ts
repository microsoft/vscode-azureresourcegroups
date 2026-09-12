/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { type DeploymentPlanData } from '../../src/webviews/copilotOnRails/views/utils/deploymentPlanTypes';
import {
    getPreparePlanRenderIssue,
    getServiceDisplayName,
    isPreparePlanJson,
    parsePreparePlanJson,
} from '../../src/webviews/copilotOnRails/views/utils/parsePreparePlanJson';
import { getWorkspaceFolderUri } from '../testUtils';

const scrapbookProjectFolder = 'copilotOnRails-scrapbook';

suite('parsePreparePlanJson', () => {
    suite('isPreparePlanJson', () => {
        test('recognizes a prepare plan document', () => {
            assert.strictEqual(isPreparePlanJson('{ "services": [], "costEstimate": {} }'), true);
        });

        test('rejects markdown and unrelated JSON', () => {
            assert.strictEqual(isPreparePlanJson('# Azure Deployment Plan\n\n| a | b |'), false);
            assert.strictEqual(isPreparePlanJson('{ "hello": "world" }'), false);
            assert.strictEqual(isPreparePlanJson('{ not json'), false);
        });
    });

    suite('canonical prepare-plan.json fixture', () => {
        test('projects services into the editable resources table with SKU last', () => {
            const plan = loadPlan();

            assert.deepStrictEqual(plan.resources.headers, ['Service', 'Resource Name', 'Component', 'Purpose', 'SKU']);
            assert.strictEqual(plan.resources.rows.length, 9);

            const [firstRow] = plan.resources.rows;
            assert.strictEqual(firstRow[0], 'Functions App');
            assert.strictEqual(firstRow[1], 'func-scrapbook-dev-5381');
            assert.strictEqual(firstRow[2], 'scrapbook-api');
            assert.strictEqual(firstRow[firstRow.length - 1], 'FlexConsumption (FC1)');
        });

        test('appends the engine version to the resource name for database services', () => {
            const plan = loadPlan();
            const postgresRow = plan.resources.rows.find((row) => row[0] === 'PostgreSQL Flexible Server');
            assert.strictEqual(postgresRow?.[1], 'psql-scrapbook-dev-5381 (v16)');
        });

        test('reads the region from deploymentVariables', () => {
            const plan = loadPlan();

            assert.strictEqual(plan.locationCode, 'eastus2');
            // The plan carries only the ARM region code; its display name and the picker's options
            // come from the live location list the view reads from ARM.
            assert.strictEqual(plan.location, '');
            assert.strictEqual(plan.availableLocations, undefined);
        });

        test('reads the cost estimate with its breakdown', () => {
            const plan = loadPlan();

            assert.strictEqual(plan.costEstimate?.monthlyUsd, 23);
            assert.strictEqual(plan.costEstimate?.currency, 'USD');
            assert.strictEqual(plan.costEstimate?.breakdown.length, 8);
            assert.ok(plan.costEstimate?.disclaimer?.includes('best-effort'));
        });

        test('reads the environment name and post-deploy recommendations', () => {
            const plan = loadPlan();

            assert.strictEqual(plan.deploymentVariables?.environmentName, 'scrapbook-dev-5381');
            assert.strictEqual(plan.postDeployRecommendations?.length, 5);
            assert.strictEqual(plan.postDeployRecommendations?.[0].effort, 'low');
        });

        test('renders without an issue', () => {
            const content = readFixture();
            assert.strictEqual(getPreparePlanRenderIssue(content, parsePreparePlanJson(content)), undefined);
        });
    });

    suite('tolerance', () => {
        test('renders a partially written plan', () => {
            const plan = parsePreparePlanJson('{ "services": [{ "name": "appService", "sku": "B1" }] }');

            assert.strictEqual(plan.resources.rows.length, 1);
            assert.strictEqual(plan.resources.rows[0][0], 'App Service');
            assert.strictEqual(plan.costEstimate, undefined);
            assert.strictEqual(plan.locationCode, '');
        });

        test('ignores fields of the wrong shape', () => {
            const plan = parsePreparePlanJson('{ "services": "nope", "costEstimate": 5, "deploymentVariables": "nope" }');

            assert.deepStrictEqual(plan.services, []);
            assert.strictEqual(plan.costEstimate, undefined);
            assert.strictEqual(plan.deploymentVariables, undefined);
        });

        test('reports render issues for empty and service-less plans', () => {
            assert.strictEqual(getPreparePlanRenderIssue('  ', undefined), 'empty');
            assert.strictEqual(getPreparePlanRenderIssue('{ bad', undefined), 'invalidJson');
            assert.strictEqual(getPreparePlanRenderIssue('{}', parsePreparePlanJson('{}')), 'missingServices');
        });

        test('sums the cost breakdown when the total is missing', () => {
            const plan = parsePreparePlanJson(JSON.stringify({
                services: [{ name: 'keyVault', resourceName: 'kv-test' }],
                costEstimate: { breakdown: [{ service: 'Key Vault', sku: 'standard', monthlyUsd: 0.1 }, { service: 'Storage', sku: 'Standard_LRS', monthlyUsd: 1 }] },
            }));

            assert.strictEqual(plan.costEstimate?.monthlyUsd, 1.1);
        });

        test('falls back to a de-camel-cased label for unknown service names', () => {
            assert.strictEqual(getServiceDisplayName('staticWebApp'), 'Static Web Apps');
            assert.strictEqual(getServiceDisplayName('someNewService'), 'Some New Service');
        });
    });
});

function readFixture(): string {
    const fixtureUri = Uri.joinPath(getWorkspaceFolderUri(scrapbookProjectFolder), 'prepare-plan.json');
    return fs.readFileSync(fixtureUri.fsPath, 'utf8');
}

function loadPlan(): DeploymentPlanData {
    return parsePreparePlanJson(readFixture());
}
