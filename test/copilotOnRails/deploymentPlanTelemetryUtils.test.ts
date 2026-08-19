/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { DEPLOYMENT_PLAN_TELEMETRY_PREFIX, DeploymentPlanTelemetry, getDeploymentPlanTelemetry } from '../../src/webviews/copilotOnRails/extension/utils/deploymentPlanTelemetryUtils';
import { parsePreparePlanJson } from '../../src/webviews/copilotOnRails/views/utils/parsePreparePlanJson';
import { getWorkspaceFolderUri } from '../testUtils';

const scrapbookProjectFolder = 'copilotOnRails-scrapbook';
const attendanceProjectFolder = 'copilotOnRails-attendance';

suite('deploymentPlanTelemetryUtils', () => {
    suite('getDeploymentPlanTelemetry', () => {
        test('scrapbook project', () => {
            const telemetry = loadDeploymentPlanTelemetry(scrapbookProjectFolder);

            const expected: DeploymentPlanTelemetry = {
                planParsedOk: true,

                location: 'eastus2',

                coreServiceCount: 5,
                coreServiceTypes: 'functions,staticwebapp,storageaccount,postgresflexibleserver,azureopenai',
                coreServiceSkus: 'flexconsumption (fc1),free,standard_lrs,standard_b1ms,s0',
                hasDatabase: true,

                supportingServiceCount: 4,
                supportingServiceTypes: 'keyvault,userassignedidentity,loganalyticsworkspace,applicationinsights',

                estimatedMonthlyCost: 23,
            };

            assert.deepStrictEqual(telemetry, expected);
        });

        test('attendance project', () => {
            const telemetry = loadDeploymentPlanTelemetry(attendanceProjectFolder);

            const expected: DeploymentPlanTelemetry = {
                planParsedOk: true,

                location: 'westus2',

                coreServiceCount: 4,
                coreServiceTypes: 'functions,staticwebapp,storageaccount,postgresflexibleserver',
                coreServiceSkus: 'flexconsumption (fc1),free,standard_lrs,standard_b1ms',
                hasDatabase: true,

                supportingServiceCount: 4,
                supportingServiceTypes: 'keyvault,userassignedidentity,loganalyticsworkspace,applicationinsights',

                estimatedMonthlyCost: 18.1,
            };

            assert.deepStrictEqual(telemetry, expected);
        });

        test('all telemetry keys share the deploymentPlan prefix once flattened', () => {
            const telemetry = loadDeploymentPlanTelemetry(scrapbookProjectFolder);
            const flattened = Object.fromEntries(
                Object.entries(telemetry).map(([key, value]) => [`${DEPLOYMENT_PLAN_TELEMETRY_PREFIX}${key}`, value]),
            );
            assert.ok(Object.keys(flattened).every(key => key.startsWith('deploymentPlan.')));
        });
    });

    suite('edge cases', () => {
        test('reports unknowns and no database for an empty plan', () => {
            const telemetry = getDeploymentPlanTelemetry(parsePreparePlanJson('{}'));

            assert.strictEqual(telemetry.location, 'unknown');
            assert.strictEqual(telemetry.coreServiceCount, 0);
            assert.strictEqual(telemetry.coreServiceTypes, '');
            assert.strictEqual(telemetry.coreServiceSkus, '');
            assert.strictEqual(telemetry.hasDatabase, false);
            assert.strictEqual(telemetry.supportingServiceCount, 0);
            assert.strictEqual(telemetry.estimatedMonthlyCost, 0);
        });

        test('splits core services from supporting services', () => {
            const plan = parsePreparePlanJson(JSON.stringify({
                services: [
                    { name: 'functions', sku: 'FC1', resourceName: 'func-a' },
                    { name: 'functions', sku: 'FC1', resourceName: 'func-b' },
                    { name: 'cosmosDb', sku: 'Serverless', resourceName: 'cosmos-a' },
                    { name: 'keyVault', sku: 'standard', resourceName: 'kv-a' },
                    { name: 'applicationInsights', sku: 'n/a', resourceName: 'appi-a' },
                ],
            }));

            const telemetry = getDeploymentPlanTelemetry(plan);

            assert.strictEqual(telemetry.coreServiceCount, 2);
            assert.strictEqual(telemetry.coreServiceTypes, 'functions,cosmosdb');
            assert.strictEqual(telemetry.coreServiceSkus, 'fc1,serverless');
            assert.strictEqual(telemetry.hasDatabase, true);
            assert.strictEqual(telemetry.supportingServiceCount, 2);
            assert.strictEqual(telemetry.supportingServiceTypes, 'keyvault,applicationinsights');
        });
    });
});

function loadDeploymentPlanTelemetry(workspaceFolderName: string): DeploymentPlanTelemetry {
    const fixtureUri = Uri.joinPath(getWorkspaceFolderUri(workspaceFolderName), 'prepare-plan.json');
    return getDeploymentPlanTelemetry(parsePreparePlanJson(fs.readFileSync(fixtureUri.fsPath, 'utf8')));
}
