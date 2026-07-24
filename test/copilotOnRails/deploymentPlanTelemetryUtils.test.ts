/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { DEPLOYMENT_PLAN_TELEMETRY_PREFIX, DeploymentPlanTelemetry, getDeploymentPlanTelemetry } from '../../src/webviews/copilotOnRails/extension/utils/deploymentPlanTelemetryUtils';
import { parseDeploymentPlanMarkdown } from '../../src/webviews/copilotOnRails/views/utils/parseDeploymentPlanMarkdown';
import { getWorkspaceFolderUri } from '../testUtils';

const attendanceProjectFolder = 'copilotOnRails-attendance';
const scrapbookProjectFolder = 'copilotOnRails-scrapbook';

suite('deploymentPlanTelemetryUtils', () => {
    suite('getDeploymentPlanTelemetry', () => {
        test('attendance project', () => {
            const telemetry = loadDeploymentPlanTelemetry(attendanceProjectFolder);

            const expected: DeploymentPlanTelemetry = {
                planParsedOk: true,
                planStatus: 'planning',

                subscriptionId: 'AzCode2605',
                location: 'westus2',

                classification: 'development',
                scale: 'small',
                budget: 'cost-optimized',

                recipe: 'azd (bicep)',
                stack: 'serverless (functions flex consumption + static web apps)',

                coreServiceCount: 4,
                coreServiceTypes: 'azure functions,azure static web apps,azure database for postgresql flexible server,azure storage account',
                coreServiceSkus: 'flex consumption (fc1),free,burstable b1ms,standard lrs',
                hasDatabase: true,

                supportingServiceCount: 4,
                supportingServiceTypes: 'log analytics workspace,application insights,key vault,user assigned managed identity',
            };

            assert.deepStrictEqual(telemetry, expected);
        });

        test('scrapbook project', () => {
            const telemetry = loadDeploymentPlanTelemetry(scrapbookProjectFolder);

            const expected: DeploymentPlanTelemetry = {
                planParsedOk: true,
                planStatus: 'planning',

                subscriptionId: 'AzCode2605',
                location: 'westus2',

                classification: 'development',
                scale: 'small',
                budget: 'cost-optimized',

                recipe: 'azd (bicep)',
                stack: 'serverless + static web apps',

                coreServiceCount: 4,
                coreServiceTypes: 'azure functions (flex consumption),azure static web apps,azure database for postgresql flexible server,azure storage account (blob)',
                coreServiceSkus: 'fc1,free,burstable b1ms,standard_lrs',
                hasDatabase: true,

                supportingServiceCount: 4,
                supportingServiceTypes: 'log analytics workspace,application insights,key vault,user assigned managed identity',
            };

            assert.deepStrictEqual(telemetry, expected);
        });

        test('all telemetry keys share the deploymentPlan prefix once flattened', () => {
            const telemetry = loadDeploymentPlanTelemetry(attendanceProjectFolder);
            const flattened = Object.fromEntries(
                Object.entries(telemetry).map(([key, value]) => [`${DEPLOYMENT_PLAN_TELEMETRY_PREFIX}${key}`, value]),
            );
            assert.ok(Object.keys(flattened).every(key => key.startsWith('deploymentPlan.')));
        });
    });

    suite('edge cases', () => {
        test('reports unknowns and no database for an empty plan', () => {
            const telemetry = getDeploymentPlanTelemetry(parseDeploymentPlanMarkdown(''));

            assert.strictEqual(telemetry.planStatus, 'unknown');
            assert.strictEqual(telemetry.subscriptionId, '');
            assert.strictEqual(telemetry.location, 'unknown');
            assert.strictEqual(telemetry.recipe, 'unknown');
            assert.strictEqual(telemetry.stack, 'unknown');
            assert.strictEqual(telemetry.classification, 'unknown');
            assert.strictEqual(telemetry.coreServiceCount, 0);
            assert.strictEqual(telemetry.coreServiceTypes, '');
            assert.strictEqual(telemetry.coreServiceSkus, '');
            assert.strictEqual(telemetry.hasDatabase, false);
            assert.strictEqual(telemetry.supportingServiceCount, 0);
        });

        test('derives distinct core services and SKUs from a service mapping table', () => {
            const markdown = [
                '# Azure Deployment Plan',
                '',
                '## Architecture',
                '',
                '### Service Mapping',
                '',
                '| Component | Azure Service | SKU |',
                '|-----------|---------------|-----|',
                '| api | Azure Functions | FC1 |',
                '| worker | Azure Functions | FC1 |',
                '| db | Azure Cosmos DB | Serverless |',
                '',
                '### Supporting Services',
                '',
                '| Service | Purpose |',
                '|---------|---------|',
                '| Key Vault | Secrets |',
                '| Application Insights | Monitoring |',
            ].join('\n');

            const telemetry = getDeploymentPlanTelemetry(parseDeploymentPlanMarkdown(markdown));

            assert.strictEqual(telemetry.coreServiceCount, 2);
            assert.strictEqual(telemetry.coreServiceTypes, 'azure functions,azure cosmos db');
            assert.strictEqual(telemetry.coreServiceSkus, 'fc1,serverless');
            assert.strictEqual(telemetry.hasDatabase, true);
            assert.strictEqual(telemetry.supportingServiceCount, 2);
            assert.strictEqual(telemetry.supportingServiceTypes, 'key vault,application insights');
        });
    });
});

function loadDeploymentPlanTelemetry(workspaceFolderName: string): DeploymentPlanTelemetry {
    const fixtureUri = Uri.joinPath(getWorkspaceFolderUri(workspaceFolderName), 'deployment-plan.md');
    const markdown = fs.readFileSync(fixtureUri.fsPath, 'utf8');
    return getDeploymentPlanTelemetry(parseDeploymentPlanMarkdown(markdown));
}
