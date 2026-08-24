/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { getDeployResultRenderIssue, parseDeployResultJson } from '../../src/webviews/copilotOnRails/views/utils/parseDeployResultJson';
import { getWorkspaceFolderUri } from '../testUtils';

const scrapbookProjectFolder = 'copilotOnRails-scrapbook';

function readDeployResult(projectFolder: string): string {
    const folderUri: Uri = getWorkspaceFolderUri(projectFolder);
    return fs.readFileSync(Uri.joinPath(folderUri, 'deploy-result.json').fsPath, 'utf8');
}

suite('parseDeployResultJson', () => {
    suite('object-map artifact (scrapbook fixture)', () => {
        const content = () => readDeployResult(scrapbookProjectFolder);

        test('reads the top-level deployment identity', () => {
            const result = parseDeployResultJson(content());

            assert.strictEqual(result.status, 'succeeded');
            assert.strictEqual(result.healthStatus, 'healthy');
            assert.strictEqual(result.partial, false);
            assert.strictEqual(result.resourceGroupName, 'rg-scrapbook-dev-5381');
            assert.strictEqual(result.region, 'eastus2');
            assert.strictEqual(result.subscriptionId, '9b5c7ccb-9857-4307-843b-8875e83f65e9');
            assert.strictEqual(result.sessionId, '5381e26f-f598-415f-bd03-e3678f1060bc');
        });

        test('computes elapsed time from top-level timestamps', () => {
            const result = parseDeployResultJson(content());

            assert.strictEqual(result.durationLabel, '1d 18h 19m');
        });

        test('builds the portal link and cleanup command from the resource group', () => {
            const result = parseDeployResultJson(content());

            assert.strictEqual(
                result.portalUrl,
                'https://portal.azure.com/#@/resource/subscriptions/9b5c7ccb-9857-4307-843b-8875e83f65e9/resourceGroups/rg-scrapbook-dev-5381/overview',
            );
            assert.strictEqual(result.cleanupCommand, 'az group delete -n rg-scrapbook-dev-5381 --yes --no-wait');
        });

        test('normalizes the endpoints object map and labels each entry', () => {
            const result = parseDeployResultJson(content());

            assert.deepStrictEqual(
                result.endpoints.map(e => [e.name, e.label, e.url]),
                [
                    ['api', 'API', 'https://func-scrapbook-dev-5381.azurewebsites.net'],
                    ['health', 'Health check', 'https://func-scrapbook-dev-5381.azurewebsites.net/api/health'],
                    ['web', 'Web', 'https://nice-pebble-007cd0f0f.7.azurestaticapps.net'],
                ],
            );
        });

        test('features the web endpoint rather than the API or health check', () => {
            const result = parseDeployResultJson(content());

            assert.strictEqual(result.primaryEndpoint?.name, 'web');
            assert.strictEqual(result.primaryEndpoint?.url, 'https://nice-pebble-007cd0f0f.7.azurestaticapps.net');
        });

        test('features no endpoint when the deployment is backend-only', () => {
            // "Open app" must stay hidden rather than opening a Function App URL:
            // there is no browsable front end in this deployment.
            const result = parseDeployResultJson(JSON.stringify({
                endpoints: {
                    api: 'https://func-scrapbook-dev-5381.azurewebsites.net',
                    health: 'https://func-scrapbook-dev-5381.azurewebsites.net/api/health',
                },
            }));

            assert.strictEqual(result.primaryEndpoint, undefined);
            assert.strictEqual(result.endpoints.length, 2, 'backend endpoints stay listed in the endpoints section');
        });

        test('features a front end named something other than "web"', () => {
            const result = parseDeployResultJson(JSON.stringify({
                endpoints: {
                    api: 'https://func-scrapbook-dev-5381.azurewebsites.net',
                    frontend: 'https://nice-pebble-007cd0f0f.7.azurestaticapps.net',
                },
            }));

            assert.strictEqual(result.primaryEndpoint?.name, 'frontend');
            assert.strictEqual(result.primaryEndpoint?.url, 'https://nice-pebble-007cd0f0f.7.azurestaticapps.net');
        });

        test('features a Static Web App even when the artifact omits endpoint names', () => {
            // The array form carries no `name`, so every entry falls back to the
            // generic `endpoint` and only the host identifies the front end.
            const result = parseDeployResultJson(JSON.stringify({
                endpoints: [
                    { url: 'https://func-offcompl-dev-48c0.azurewebsites.net/api' },
                    { url: 'https://witty-stone-0bab4f50f.7.azurestaticapps.net' },
                ],
            }));

            assert.strictEqual(result.primaryEndpoint?.url, 'https://witty-stone-0bab4f50f.7.azurestaticapps.net');
        });

        test('features no endpoint when unnamed endpoints are all backends', () => {
            const result = parseDeployResultJson(JSON.stringify({
                endpoints: [{ url: 'https://func-offcompl-dev-48c0.azurewebsites.net/api' }],
            }));

            assert.strictEqual(result.primaryEndpoint, undefined);
        });

        test('maps resource keys onto friendly type names', () => {
            const result = parseDeployResultJson(content());

            assert.strictEqual(result.resources.length, 9);
            assert.deepStrictEqual(result.resources[0], { type: 'Function App', name: 'func-scrapbook-dev-5381' });
            assert.deepStrictEqual(
                result.resources.find(r => r.name === 'cog-scrapbook-dev-5381'),
                { type: 'Azure OpenAI', name: 'cog-scrapbook-dev-5381' },
            );
        });

        test('reads health-check dependencies including the optional flag', () => {
            const result = parseDeployResultJson(content());

            assert.strictEqual(result.healthDetail?.endpoint, '/api/health');
            assert.deepStrictEqual(
                result.healthDetail?.services.map(s => [s.name, s.state, s.essential]),
                [
                    ['postgres', 'up', true],
                    ['blob', 'up', true],
                    ['queue', 'up', true],
                    ['openai', 'up', false],
                ],
            );
        });

        test('flattens the nested basic-publishing network policy', () => {
            const result = parseDeployResultJson(content());

            assert.deepStrictEqual(result.networkPolicy, {
                mainSite: 'Allow (public)',
                scmSite: 'Deny all',
                basicPublishingScm: false,
                basicPublishingFtp: false,
            });
        });

        test('reads narrative healing attempts verbatim', () => {
            const result = parseDeployResultJson(content());

            assert.strictEqual(result.healingAttempts.length, 4);
            assert.strictEqual(result.healingAttempts[0].attempt, 1);
            assert.strictEqual(
                result.healingAttempts[0].issue,
                'az functionapp deployment source config-zip hung on FlexConsumption',
            );
            assert.strictEqual(
                result.healingAttempts[0].resolution,
                'Abandoned; switched to direct blob upload + OneDeploy REST call',
            );
        });

        test('renders without a render issue', () => {
            const raw = content();

            assert.strictEqual(getDeployResultRenderIssue(raw, parseDeployResultJson(raw)), undefined);
        });
    });

    suite('documented schema shape (deploy-schemas.ts)', () => {
        // Mirrors the DeployResult interface: array endpoints, nested duration,
        // resourceResults[], and structured healing attempts.
        const schemaShaped = JSON.stringify({
            sessionId: 'session-1',
            subscriptionId: 'sub-1',
            resourceGroupName: 'rg-1',
            status: 'failed',
            deploymentNames: ['deploy-1'],
            healthStatus: 'degraded',
            partial: true,
            warnings: ['SKU downgraded to stay in budget'],
            duration: { startedUtc: '2026-08-13T10:00:00Z', completedUtc: '2026-08-13T10:04:32Z' },
            endpoints: [{ name: 'api', url: 'https://api.example.com', healthStatus: 'unreachable' }],
            resourceResults: [{
                resourceId: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Web/sites/func-x',
                type: 'Microsoft.Web/sites',
                status: 'failed',
                error: 'Deployment quota exceeded',
            }],
            createdResources: [{
                id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Web/sites/func-x',
                name: 'func-x',
                type: 'Microsoft.Web/sites',
                provisioningState: 'Failed',
                classification: 'failed',
            }],
            orphanedResourceGroups: [{ name: 'rg-old', region: 'eastus', healingAttempt: 1, reason: 'region fallback' }],
            healingAttempts: [{
                attempt: 1,
                phase: 'deployment',
                errors: [{ source: 'arm', detail: 'quota exceeded', classification: 'INFRA_TRANSIENT' }],
                action: 'retried',
                result: 'fixed',
                planLevelChange: true,
            }],
        });

        test('reads timestamps nested under duration', () => {
            const result = parseDeployResultJson(schemaShaped);

            assert.strictEqual(result.durationLabel, '4m 32s');
        });

        test('reads array endpoints with per-endpoint health', () => {
            const result = parseDeployResultJson(schemaShaped);

            assert.deepStrictEqual(result.endpoints, [{
                name: 'api',
                label: 'API',
                url: 'https://api.example.com',
                healthStatus: 'unreachable',
            }]);
        });

        test('uses the deterministic created-resources inventory when present', () => {
            const result = parseDeployResultJson(schemaShaped);

            assert.deepStrictEqual(result.resources, [{
                type: 'Sites',
                name: 'func-x',
                status: 'failed · Failed',
            }]);
        });

        test('builds a per-resource cleanup list from failed/orphaned inventory entries', () => {
            const result = parseDeployResultJson(schemaShaped);

            assert.deepStrictEqual(result.resourcesToCleanup, [{
                type: 'Sites',
                name: 'func-x',
                id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Web/sites/func-x',
                resourceGroup: 'rg-1',
                classification: 'failed',
                deleteCommand: 'az resource delete --ids "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Web/sites/func-x"',
            }]);
        });

        test('excludes expected resources and includes orphaned ones in the cleanup list', () => {
            const result = parseDeployResultJson(JSON.stringify({
                createdResources: [
                    {
                        id: '/subscriptions/s/resourceGroups/rg-1/providers/Microsoft.Web/sites/keep-me',
                        name: 'keep-me',
                        type: 'Microsoft.Web/sites',
                        classification: 'expected',
                    },
                    {
                        id: '/subscriptions/s/resourceGroups/rg-stray/providers/Microsoft.ManagedIdentity/userAssignedIdentities/stray-mi',
                        name: 'stray-mi',
                        type: 'Microsoft.ManagedIdentity/userAssignedIdentities',
                        classification: 'orphaned',
                    },
                ],
            }));

            assert.deepStrictEqual(result.resourcesToCleanup, [{
                type: 'UserAssignedIdentities',
                name: 'stray-mi',
                id: '/subscriptions/s/resourceGroups/rg-stray/providers/Microsoft.ManagedIdentity/userAssignedIdentities/stray-mi',
                resourceGroup: 'rg-stray',
                classification: 'orphaned',
                deleteCommand: 'az resource delete --ids "/subscriptions/s/resourceGroups/rg-stray/providers/Microsoft.ManagedIdentity/userAssignedIdentities/stray-mi"',
            }]);
        });

        test('falls back to a name/group/type delete command when the inventory omits the ID', () => {
            const result = parseDeployResultJson(JSON.stringify({
                createdResources: [{
                    name: 'stray-mi',
                    type: 'Microsoft.ManagedIdentity/userAssignedIdentities',
                    resourceGroup: 'rg-stray',
                    classification: 'orphaned',
                }],
            }));

            assert.deepStrictEqual(result.resourcesToCleanup, [{
                type: 'UserAssignedIdentities',
                name: 'stray-mi',
                id: undefined,
                resourceGroup: 'rg-stray',
                classification: 'orphaned',
                deleteCommand: 'az resource delete --name "stray-mi" --resource-group "rg-stray" --resource-type "Microsoft.ManagedIdentity/userAssignedIdentities"',
            }]);
        });

        test('falls back to resourceResults, keeping status and error', () => {
            const result = parseDeployResultJson(JSON.stringify({
                resourceResults: [{
                    resourceId: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Web/sites/func-x',
                    type: 'Microsoft.Web/sites',
                    status: 'failed',
                    error: 'Deployment quota exceeded',
                }],
            }));

            assert.deepStrictEqual(result.resources, [{
                type: 'Sites',
                name: 'func-x',
                status: 'failed',
                error: 'Deployment quota exceeded',
            }]);
        });

        test('flattens structured healing attempts into issue and resolution text', () => {
            const result = parseDeployResultJson(schemaShaped);

            assert.deepStrictEqual(result.healingAttempts, [{
                attempt: 1,
                issue: 'arm: quota exceeded',
                resolution: 'retried → fixed',
                planLevelChange: true,
            }]);
        });

        test('reads warnings, partial, and orphaned resource groups', () => {
            const result = parseDeployResultJson(schemaShaped);

            assert.strictEqual(result.partial, true);
            assert.deepStrictEqual(result.warnings, ['SKU downgraded to stay in budget']);
            assert.deepStrictEqual(result.orphanedResourceGroups, [{
                name: 'rg-old',
                region: 'eastus',
                reason: 'region fallback',
            }]);
        });

        test('falls back to resourceIds when no resourceResults are present', () => {
            const result = parseDeployResultJson(JSON.stringify({
                resourceIds: ['/subscriptions/s/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/kv-x'],
            }));

            assert.deepStrictEqual(result.resources, [{ type: 'Vaults', name: 'kv-x' }]);
        });
    });

    suite('edge cases', () => {
        test('tolerates a skeleton artifact written before deployment starts', () => {
            const result = parseDeployResultJson(JSON.stringify({
                sessionId: 'session-1',
                status: 'in-progress',
                resourceGroupName: 'rg-1',
                endpoints: [],
                resourceIds: [],
                healthStatus: 'unknown',
            }));

            assert.strictEqual(result.status, 'in-progress');
            assert.strictEqual(result.healthStatus, 'unknown');
            assert.strictEqual(result.durationLabel, '');
            assert.strictEqual(result.primaryEndpoint, undefined);
            assert.deepStrictEqual(result.resources, []);
        });

        test('coerces unrecognized status and health values to unknown', () => {
            const result = parseDeployResultJson(JSON.stringify({ status: 'partially-done', healthStatus: 'meh' }));

            assert.strictEqual(result.status, 'unknown');
            assert.strictEqual(result.healthStatus, 'unknown');
        });

        test('reports an empty file as an empty render issue', () => {
            assert.strictEqual(getDeployResultRenderIssue('   ', parseDeployResultJson('{}')), 'empty');
        });

        test('reports an artifact with no deployment data as unsupported', () => {
            assert.strictEqual(getDeployResultRenderIssue('{}', parseDeployResultJson('{}')), 'unsupported');
        });

        test('throws on malformed JSON so the caller can show a parse error', () => {
            assert.throws(() => parseDeployResultJson('{ not json'));
        });

        test('ignores endpoint entries that have no URL', () => {
            const result = parseDeployResultJson(JSON.stringify({
                endpoints: { api: '', web: 'https://web.example.com' },
            }));

            assert.deepStrictEqual(result.endpoints.map(e => e.name), ['web']);
        });
    });
});
