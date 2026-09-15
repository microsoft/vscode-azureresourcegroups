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

    suite('alternate prepare-plan dialect', () => {
        // Some prepare runs emit `kind`/`componentId`/`notes` services, an object-map
        // `naming.resources`, `costEstimate.items`, and `id`/`message`/`priority`
        // recommendations. The view renders that shape instead of reporting no services.
        const altPlan = JSON.stringify({
            region: 'eastus2',
            naming: {
                resourcePrefix: 'attendance-dev-cec6',
                resources: {
                    resourceGroup: 'rg-attendance-dev-cec6',
                    functionApp: 'func-attendance-dev-cec6',
                    storageAccount: 'stattendancedevcec6',
                    postgresServer: 'psql-attendance-dev-cec6',
                    logAnalytics: 'log-attendance-dev-cec6',
                },
            },
            services: [
                { id: 'attendance-api', kind: 'azure-functions', sku: 'Flex Consumption (FC1)', componentId: 'attendance-api', notes: 'Flex Consumption host.' },
                { id: 'attendance-db', kind: 'postgres-flexible-server', sku: 'Burstable B1ms', version: '16', region: 'eastus2' },
                { id: 'attendance-logs', kind: 'log-analytics', sku: 'PerGB2018' },
            ],
            costEstimate: {
                currency: 'USD',
                monthlyTotalUsd: 32,
                items: [
                    { service: 'Function App', monthlyUsd: 2, assumption: 'Dev traffic.' },
                    { service: 'PostgreSQL Flexible Server', monthlyUsd: 16 },
                ],
                assumptions: ['Best-effort estimates from public Azure retail pricing.'],
            },
            postDeployRecommendations: [
                { id: 'replace-mock-auth', priority: 'high', message: 'Replace the mock auth secret with Entra ID.' },
            ],
        });

        test('renders services declared with kind/componentId/notes', () => {
            const plan = parsePreparePlanJson(altPlan);

            assert.strictEqual(getPreparePlanRenderIssue(altPlan, plan), undefined);
            assert.strictEqual(plan.resources.rows.length, 3);
            assert.deepStrictEqual(plan.resources.rows[0], [
                'Functions App',
                'func-attendance-dev-cec6',
                'attendance-api',
                'Flex Consumption host.',
                'Flex Consumption (FC1)',
            ]);
        });

        test('resolves resource names from an object-map naming.resources', () => {
            const plan = parsePreparePlanJson(altPlan);

            assert.strictEqual(plan.resources.rows[1][1], 'psql-attendance-dev-cec6 (v16)');
            assert.strictEqual(plan.resources.rows[2][1], 'log-attendance-dev-cec6');
        });

        test('falls back to the plan-level region and naming prefix', () => {
            const plan = parsePreparePlanJson(altPlan);

            assert.strictEqual(plan.locationCode, 'eastus2');
            assert.strictEqual(plan.services?.[0].region, 'eastus2');
            assert.strictEqual(plan.deploymentVariables?.environmentName, 'attendance-dev-cec6');
        });

        test('reads the cost estimate from items/monthlyTotalUsd', () => {
            const plan = parsePreparePlanJson(altPlan);

            assert.strictEqual(plan.costEstimate?.monthlyUsd, 32);
            assert.strictEqual(plan.costEstimate?.breakdown.length, 2);
            assert.strictEqual(plan.costEstimate?.breakdown[0].note, 'Dev traffic.');
            assert.ok(plan.costEstimate?.disclaimer?.includes('Best-effort'));
        });

        test('reads recommendations written as id/priority/message', () => {
            const plan = parsePreparePlanJson(altPlan);
            const [recommendation] = plan.postDeployRecommendations ?? [];

            assert.strictEqual(recommendation?.title, 'Replace Mock Auth');
            assert.strictEqual(recommendation?.effort, 'high');
            assert.ok(recommendation?.reason.startsWith('Replace the mock auth secret'));
        });

        test('maps kebab-case service tokens to their friendly names', () => {
            assert.strictEqual(getServiceDisplayName('azure-functions'), 'Functions App');
            assert.strictEqual(getServiceDisplayName('static-web-apps'), 'Static Web Apps');
            assert.strictEqual(getServiceDisplayName('user-assigned-identity'), 'Managed Identity');
            assert.strictEqual(getServiceDisplayName('some-new-service'), 'Some New Service');
        });
    });

    suite('ARM-type prepare-plan dialect', () => {
        // Other prepare runs identify services by ARM resource type (`azureService`) with a plan
        // id, put costs in `costEstimate.byService[]` keyed by that id, write recommendations as
        // plain strings, and use azd-style `AZURE_ENV_NAME` / `AZURE_LOCATION` variables.
        const armPlan = JSON.stringify({
            region: 'eastus2',
            naming: {
                resources: {
                    resourceGroup: 'rg-occ-dev-eus2',
                    logAnalytics: 'log-occ-dev-eus2-e25891',
                    managedIdentity: 'id-occ-dev-eus2-e25891',
                    storageAccount: 'stoccdeveus2e25891',
                    postgresServer: 'psql-occ-dev-eus2-e25891',
                    postgresDatabase: 'office_compliance',
                    functionApp: 'func-occ-dev-eus2-e25891',
                    staticWebApp: 'swa-occ-dev-eus2-e25891',
                },
            },
            services: [
                { id: 'log-analytics', azureService: 'Microsoft.OperationalInsights/workspaces', sku: 'PerGB2018', region: 'eastus2', purpose: 'Diagnostics workspace', monthlyCostUsd: 2 },
                { id: 'managed-identity', azureService: 'Microsoft.ManagedIdentity/userAssignedIdentities', sku: 'n/a', region: 'eastus2', purpose: 'Passwordless auth' },
                { id: 'storage', azureService: 'Microsoft.Storage/storageAccounts', sku: 'Standard_LRS', kind: 'StorageV2', region: 'eastus2', purpose: 'Functions runtime storage' },
                { id: 'postgres', azureService: 'Microsoft.DBforPostgreSQL/flexibleServers', sku: 'Standard_B1ms', tier: 'Burstable', version: '16', region: 'eastus2', purpose: 'Primary relational store' },
                { id: 'function-app', azureService: 'Microsoft.Web/sites', kind: 'functionapp,linux', hostingPlan: 'FlexConsumption', planSku: 'FC1', region: 'eastus2', purpose: 'Functions v4 host' },
                { id: 'static-web-app', azureService: 'Microsoft.Web/staticSites', sku: 'Free', region: 'eastus2', purpose: 'React SPA' },
            ],
            componentMapping: [
                { componentId: 'office-compliance-api', targetService: 'function-app', deployStrategy: 'azd/zipdeploy' },
                { componentId: 'office-compliance-portal', targetService: 'static-web-app', deployStrategy: 'SWA CLI deploy' },
            ],
            // eslint-disable-next-line @typescript-eslint/naming-convention -- azd variable names, as the plan writes them
            deploymentVariables: { AZURE_LOCATION: 'eastus2', AZURE_ENV_NAME: 'occ-dev', NODE_VERSION: '20' },
            postDeployRecommendations: [
                'Run node-pg-migrate against the provisioned Flexible Server.',
                'Bind the Static Web App to the Function App. It becomes the linked API backend.',
            ],
            costEstimate: {
                currency: 'USD',
                period: 'monthly',
                totalUsd: 24.89,
                byService: [
                    { id: 'postgres', usd: 16.09 },
                    { id: 'log-analytics', usd: 2 },
                    { id: 'function-app', usd: 0 },
                ],
                assumptions: ['Best-effort estimate — Azure MCP pricing tools were not invoked.'],
            },
        });

        test('renders every service identified only by ARM resource type', () => {
            const plan = parsePreparePlanJson(armPlan);

            assert.strictEqual(getPreparePlanRenderIssue(armPlan, plan), undefined);
            assert.deepStrictEqual(plan.resources.rows.map((row) => row[0]), [
                'Log Analytics Workspace',
                'Managed Identity',
                'Storage Account',
                'PostgreSQL Flexible Server',
                'Functions App',
                'Static Web Apps',
            ]);
        });

        test('prefers the ARM type over a literal Azure kind', () => {
            const plan = parsePreparePlanJson(armPlan);

            // `kind` here is the storage account kind ("StorageV2"), not a service token.
            const storageRow = plan.resources.rows.find((row) => row[0] === 'Storage Account');
            assert.strictEqual(storageRow?.[1], 'stoccdeveus2e25891');
        });

        test('distinguishes a function app from a web app by kind', () => {
            const functionsPlan = parsePreparePlanJson(armPlan);
            assert.ok(functionsPlan.resources.rows.some((row) => row[0] === 'Functions App'));

            const webAppPlan = parsePreparePlanJson(JSON.stringify({
                services: [{ id: 'web', azureService: 'Microsoft.Web/sites', kind: 'app,linux', sku: 'B1' }],
            }));
            assert.strictEqual(webAppPlan.resources.rows[0][0], 'App Service');
        });

        test('fills the component column from componentMapping', () => {
            const plan = parsePreparePlanJson(armPlan);

            const functionRow = plan.resources.rows.find((row) => row[0] === 'Functions App');
            assert.strictEqual(functionRow?.[2], 'office-compliance-api');
            assert.strictEqual(functionRow?.[4], 'FC1');
        });

        test('reads the cost estimate from byService/totalUsd and labels it from services', () => {
            const plan = parsePreparePlanJson(armPlan);

            assert.strictEqual(plan.costEstimate?.monthlyUsd, 24.89);
            assert.strictEqual(plan.costEstimate?.breakdown.length, 3);
            assert.strictEqual(plan.costEstimate?.breakdown[0].service, 'PostgreSQL Flexible Server');
            assert.strictEqual(plan.costEstimate?.breakdown[0].sku, 'Standard_B1ms');
            assert.strictEqual(plan.costEstimate?.breakdown[0].monthlyUsd, 16.09);
        });

        test('reads recommendations written as plain strings', () => {
            const plan = parsePreparePlanJson(armPlan);

            assert.strictEqual(plan.postDeployRecommendations?.length, 2);
            assert.strictEqual(plan.postDeployRecommendations?.[0].title, 'Run node-pg-migrate against the provisioned Flexible Server.');
            assert.strictEqual(plan.postDeployRecommendations?.[0].reason, '');
            assert.strictEqual(plan.postDeployRecommendations?.[1].title, 'Bind the Static Web App to the Function App.');
            assert.strictEqual(plan.postDeployRecommendations?.[1].reason, 'It becomes the linked API backend.');
        });

        test('reads azd-style deployment variables', () => {
            const plan = parsePreparePlanJson(armPlan);

            assert.strictEqual(plan.deploymentVariables?.environmentName, 'occ-dev');
            assert.strictEqual(plan.locationCode, 'eastus2');
        });
    });

    suite('compound-resourceType prepare-plan dialect', () => {
        // Some plans name a service by a compound ARM type, write the SKU as an object of
        // facets, price each service inline, and nest recommendations under costEstimate.
        const compoundPlan = JSON.stringify({
            environmentName: 'attendance',
            region: 'eastus2',
            naming: { resourceToken: 'computed at deploy-time via uniqueString(...)' },
            services: [
                {
                    id: 'monitoring',
                    resourceType: 'Microsoft.Insights/components + Microsoft.OperationalInsights/workspaces',
                    purpose: 'App Insights + Log Analytics workspace.',
                    sku: { logAnalytics: 'PerGB2018', appInsights: 'web' },
                    estimatedMonthlyCostUsd: 3,
                    costAssumptions: 'Dev workload: ~1 GB/mo ingestion.',
                },
                {
                    id: 'storage',
                    resourceType: 'Microsoft.Storage/storageAccounts',
                    purpose: 'AzureWebJobsStorage.',
                    sku: { name: 'Standard_LRS', kind: 'StorageV2' },
                    estimatedMonthlyCostUsd: 0.5,
                },
                {
                    id: 'compliance-api',
                    resourceType: 'Microsoft.Web/sites (functionapp,linux) + Microsoft.Web/serverfarms',
                    purpose: 'TypeScript Azure Functions v4 HTTP API.',
                    sku: { plan: 'FC1', tier: 'FlexConsumption', instanceMemoryMB: 2048 },
                    componentPath: 'services/compliance-api',
                    estimatedMonthlyCostUsd: 3,
                },
            ],
            costEstimate: {
                currency: 'USD',
                monthlyTotalLow: 8,
                monthlyTotalHigh: 20,
                postDeployRecommendations: ['Set a subscription-level budget alert at $25/mo.'],
            },
        });

        test('resolves a service from a compound resourceType', () => {
            const plan = parsePreparePlanJson(compoundPlan);

            assert.strictEqual(plan.resources.rows.length, 3);
            assert.strictEqual(plan.resources.rows[0][0], 'Application Insights');
            assert.strictEqual(plan.resources.rows[1][0], 'Storage Account');
        });

        test('reads the ARM kind from the resourceType parenthetical', () => {
            const plan = parsePreparePlanJson(compoundPlan);

            assert.strictEqual(plan.resources.rows[2][0], 'Functions App');
            assert.strictEqual(plan.resources.rows[2][2], 'services/compliance-api');
        });

        test('flattens a SKU written as an object of facets', () => {
            const plan = parsePreparePlanJson(compoundPlan);

            assert.strictEqual(plan.resources.rows[0][4], 'PerGB2018, web');
            assert.strictEqual(plan.resources.rows[1][4], 'Standard_LRS');
            assert.strictEqual(plan.resources.rows[2][4], 'FC1');
        });

        test('builds the cost breakdown from per-service estimates', () => {
            const plan = parsePreparePlanJson(compoundPlan);

            assert.strictEqual(plan.costEstimate?.breakdown.length, 3);
            assert.strictEqual(plan.costEstimate?.monthlyUsd, 6.5);
            assert.strictEqual(plan.costEstimate?.breakdown[0].service, 'Application Insights');
            assert.strictEqual(plan.costEstimate?.breakdown[0].note, 'Dev workload: ~1 GB/mo ingestion.');
        });

        test('reads recommendations nested under costEstimate', () => {
            const plan = parsePreparePlanJson(compoundPlan);

            assert.strictEqual(plan.postDeployRecommendations?.length, 1);
            assert.strictEqual(plan.postDeployRecommendations?.[0].title, 'Set a subscription-level budget alert at $25/mo.');
        });

        test('reads a top-level environmentName', () => {
            const plan = parsePreparePlanJson(compoundPlan);

            assert.strictEqual(plan.deploymentVariables?.environmentName, 'attendance');
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

        test('uses current defaults for valid JSON with a non-object root', () => {
            for (const content of ['null', '[]', '"plan"', '42', 'true']) {
                const plan = parsePreparePlanJson(content);

                assert.deepStrictEqual(plan.services, []);
                assert.deepStrictEqual(plan.resources, { headers: [], rows: [] });
                assert.strictEqual(plan.costEstimate, undefined);
                assert.strictEqual(plan.deploymentVariables, undefined);
                assert.strictEqual(plan.locationCode, '');
            }
        });

        test('reports render issues for empty and contentless plans', () => {
            assert.strictEqual(getPreparePlanRenderIssue('  ', undefined), 'empty');
            assert.strictEqual(getPreparePlanRenderIssue('{ bad', undefined), 'invalidJson');
            assert.strictEqual(getPreparePlanRenderIssue('{}', parsePreparePlanJson('{}')), 'missingServices');
        });

        test('renders a plan whose only content is not services', () => {
            for (const content of ['{ "region": "westus" }', '{ "costEstimate": { "monthlyTotalUsd": 5 } }', '{ "postDeployRecommendations": ["Do a thing."] }']) {
                assert.strictEqual(getPreparePlanRenderIssue(content, parsePreparePlanJson(content)), undefined, content);
            }
        });

        test('keeps a service entry that matches no known Azure service', () => {
            const plan = parsePreparePlanJson('{ "services": [{ "id": "my-thing", "purpose": "does stuff" }, { "resourceType": "Microsoft.Future/widgets" }] }');

            assert.strictEqual(plan.resources.rows.length, 2);
            assert.strictEqual(plan.resources.rows[0][0], 'My Thing');
            assert.strictEqual(plan.resources.rows[1][0], 'Microsoft.Future/widgets');
        });

        test('drops only service entries with nothing to show', () => {
            const plan = parsePreparePlanJson('{ "services": [{}, null, 5, "x", { "purpose": "keep me" }] }');

            assert.strictEqual(plan.services?.length, 1);
            assert.strictEqual(plan.resources.rows[0][3], 'keep me');
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
