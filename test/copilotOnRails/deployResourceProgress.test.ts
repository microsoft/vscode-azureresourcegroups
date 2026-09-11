/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
    buildResourceSteps,
    buildResourceSummary,
    humanizeResourceType,
    mapProvisioningState,
    parseDeployTarget,
    resourceTypeLabel,
    selectTrackedDeployments,
    type ArmDeploymentLike,
    type ArmDeploymentOperationLike,
} from '../../src/webviews/copilotOnRails/extension/utils/deployResourceProgress';

function operation(id: string, provisioningState: string, resourceName?: string, resourceType?: string): ArmDeploymentOperationLike {
    return { properties: { provisioningState, targetResource: { id, resourceName, resourceType } } };
}

/** A realistic ARM resource ID, which encodes the resource type even when ARM omits the field. */
function armId(type: string, name: string): string {
    return `/subscriptions/s/resourceGroups/rg/providers/${type}/${name}`;
}

function deployment(name: string, provisioningState: string, timestamp?: Date): ArmDeploymentLike {
    return { name, properties: { provisioningState, timestamp } };
}

suite('deployResourceProgress', () => {
    suite('mapProvisioningState', () => {
        test('maps terminal ARM states onto the checklist vocabulary', () => {
            assert.strictEqual(mapProvisioningState('Succeeded'), 'done');
            assert.strictEqual(mapProvisioningState('Failed'), 'failed');
            assert.strictEqual(mapProvisioningState('Canceled'), 'failed');
        });

        test('treats every non-terminal state as still running', () => {
            for (const state of ['Accepted', 'Running', 'Creating', 'Updating', 'Deleting', undefined]) {
                assert.strictEqual(mapProvisioningState(state), 'active', `expected ${String(state)} to be active`);
            }
        });

        test('is case insensitive', () => {
            assert.strictEqual(mapProvisioningState('succeeded'), 'done');
            assert.strictEqual(mapProvisioningState('FAILED'), 'failed');
        });
    });

    suite('buildResourceSteps', () => {
        test('leads with the resource type and demotes the ARM name to a note', () => {
            const steps = buildResourceSteps([
                operation('/subscriptions/s/rg/providers/Microsoft.Web/sites/api', 'Running', 'api', 'Microsoft.Web/sites'),
            ]);

            assert.deepStrictEqual(steps, [{
                id: '/subscriptions/s/rg/providers/Microsoft.Web/sites/api',
                label: 'App Service',
                note: 'api',
                status: 'active',
            }]);
        });

        test('gives GUID-named role assignments a label that says what they are', () => {
            const steps = buildResourceSteps([
                operation('/r/ra', 'Succeeded', '20b667ce-ca4e-5826-a564-14340ab6c34e', 'Microsoft.Authorization/roleAssignments'),
            ]);

            assert.strictEqual(steps[0].label, 'Role assignment');
            assert.strictEqual(steps[0].note, '20b667ce-ca4e-5826-a564-14340ab6c34e');
        });

        test('labels child resources by their own type, keeping the parent/child name as the note', () => {
            const steps = buildResourceSteps([
                operation('/r/secret', 'Succeeded', 'kv-app-dev/database-url', 'Microsoft.KeyVault/vaults/secrets'),
            ]);

            assert.strictEqual(steps[0].label, 'Key vault secret');
            assert.strictEqual(steps[0].note, 'kv-app-dev/database-url');
        });

        test('recovers the type from the resource ID when ARM omits resourceType', () => {
            const id = armId('Microsoft.DBforPostgreSQL/flexibleServers', 'psql-app-dev');
            const steps = buildResourceSteps([operation(id, 'Running', 'psql-app-dev')]);

            assert.strictEqual(steps[0].label, 'PostgreSQL server');
            assert.strictEqual(steps[0].note, 'psql-app-dev');
        });

        test('recovers a child type from the resource ID by skipping the name segments', () => {
            const id = armId('Microsoft.KeyVault/vaults', 'kv-app-dev') + '/secrets/database-url';
            const steps = buildResourceSteps([operation(id, 'Running', 'kv-app-dev/database-url')]);

            assert.strictEqual(steps[0].label, 'Key vault secret');
        });

        test('humanizes an unmapped type rather than falling back to an opaque name', () => {
            const steps = buildResourceSteps([
                operation('/r/x', 'Running', 'thing-1', 'Microsoft.Contoso/widgetPolicies'),
            ]);

            assert.strictEqual(steps[0].label, 'Widget policy');
            assert.strictEqual(steps[0].note, 'thing-1');
        });

        test('falls back to the bare name when the type cannot be determined at all', () => {
            const steps = buildResourceSteps([{ properties: { provisioningState: 'Running', targetResource: { id: 'opaque-id', resourceName: 'api' } } }]);

            assert.strictEqual(steps[0].label, 'api');
            assert.strictEqual(steps[0].note, undefined);
        });

        test('falls back to the last ARM id segment when no resource name is reported', () => {
            const steps = buildResourceSteps([operation('/subscriptions/s/rg/providers/Microsoft.Web/sites/api', 'Succeeded')]);
            assert.strictEqual(steps[0].note, 'api');
        });

        test('ignores operations with no target resource', () => {
            assert.deepStrictEqual(buildResourceSteps([{ properties: { provisioningState: 'Running' } }, {}]), []);
        });

        test('hides nested Bicep module deployments', () => {
            const steps = buildResourceSteps([
                operation('/subscriptions/s/rg/providers/Microsoft.Resources/deployments/db-module', 'Running', 'db-module', 'Microsoft.Resources/deployments'),
                operation('/subscriptions/s/rg/providers/Microsoft.Web/sites/api', 'Running', 'api', 'Microsoft.Web/sites'),
            ]);

            assert.deepStrictEqual(steps.map((step) => step.label), ['App Service']);
        });

        test('hides nested deployments identified only by their resource ID', () => {
            const id = armId('Microsoft.Resources/deployments', 'db-module');
            assert.deepStrictEqual(buildResourceSteps([operation(id, 'Running', 'db-module')]), []);
        });

        test('collapses repeated operations for one resource, keeping the most advanced state', () => {
            const steps = buildResourceSteps([
                operation('/r/api', 'Accepted', 'api', 'Microsoft.Web/sites'),
                operation('/r/api', 'Running', 'api', 'Microsoft.Web/sites'),
                operation('/r/api', 'Succeeded', 'api', 'Microsoft.Web/sites'),
            ]);

            assert.strictEqual(steps.length, 1);
            assert.strictEqual(steps[0].status, 'done');
        });

        test('keeps a failure visible even when a retry reports an earlier state afterwards', () => {
            const steps = buildResourceSteps([
                operation('/r/db', 'Failed', 'db', 'Microsoft.Sql/servers'),
                operation('/r/db', 'Accepted', 'db', 'Microsoft.Sql/servers'),
            ]);

            assert.strictEqual(steps[0].status, 'failed');
        });

        test('orders failed, then running, then completed resources', () => {
            const steps = buildResourceSteps([
                operation('/r/done', 'Succeeded', 'zzz-done', 'Microsoft.Storage/storageAccounts'),
                operation('/r/running', 'Running', 'aaa-running', 'Microsoft.Web/sites'),
                operation('/r/failed', 'Failed', 'mmm-failed', 'Microsoft.KeyVault/vaults'),
            ]);

            assert.deepStrictEqual(steps.map((step) => step.status), ['failed', 'active', 'done']);
        });

        test('groups by resource type, then by name, so the list does not churn between polls', () => {
            const steps = buildResourceSteps([
                operation('/r/b', 'Running', 'beta', 'Microsoft.Web/sites'),
                operation('/r/kv', 'Running', 'vault', 'Microsoft.KeyVault/vaults'),
                operation('/r/a', 'Running', 'alpha', 'Microsoft.Web/sites'),
            ]);

            assert.deepStrictEqual(steps.map((step) => `${step.label}/${String(step.note)}`), [
                'App Service/alpha',
                'App Service/beta',
                'Key vault/vault',
            ]);
        });
    });

    suite('humanizeResourceType', () => {
        test('splits camel case and singularizes the leaf segment', () => {
            assert.strictEqual(humanizeResourceType('Microsoft.Web/sites/basicPublishingCredentialsPolicies'), 'Basic publishing credentials policy');
            assert.strictEqual(humanizeResourceType('Microsoft.Web/sites'), 'Site');
            assert.strictEqual(humanizeResourceType('Microsoft.Contoso/addresses'), 'Address');
        });

        test('returns undefined when there is no type to read', () => {
            assert.strictEqual(humanizeResourceType(undefined), undefined);
            assert.strictEqual(humanizeResourceType(''), undefined);
            assert.strictEqual(humanizeResourceType('   '), undefined);
        });
    });

    suite('resourceTypeLabel', () => {
        test('prefers the curated label and ignores casing', () => {
            assert.strictEqual(resourceTypeLabel('microsoft.web/serverfarms'), 'App Service plan');
            assert.strictEqual(resourceTypeLabel('Microsoft.Web/serverfarms'), 'App Service plan');
        });

        test('falls back to a humanized label for unmapped types', () => {
            assert.strictEqual(resourceTypeLabel('Microsoft.Contoso/widgets'), 'Widget');
        });

        test('returns undefined for a missing type', () => {
            assert.strictEqual(resourceTypeLabel(undefined), undefined);
        });
    });

    suite('selectTrackedDeployments', () => {
        const since = new Date('2026-01-01T10:00:00Z').getTime();

        test('always includes deployments the deploy result already named', () => {
            const names = selectTrackedDeployments(
                [deployment('known', 'Succeeded', new Date('2020-01-01T00:00:00Z'))],
                { knownNames: ['known'], since, limit: 5 },
            );

            assert.deepStrictEqual(names, ['known']);
        });

        test('includes running deployments regardless of timestamp', () => {
            const names = selectTrackedDeployments(
                [deployment('running', 'Running')],
                { knownNames: [], since, limit: 5 },
            );

            assert.deepStrictEqual(names, ['running']);
        });

        test('excludes completed deployments that predate this run', () => {
            const names = selectTrackedDeployments(
                [deployment('old', 'Succeeded', new Date('2025-06-01T00:00:00Z'))],
                { knownNames: [], since, limit: 5 },
            );

            assert.deepStrictEqual(names, []);
        });

        test('includes completed deployments that started after tracking began', () => {
            const names = selectTrackedDeployments(
                [deployment('recent', 'Succeeded', new Date('2026-01-01T10:05:00Z'))],
                { knownNames: [], since, limit: 5 },
            );

            assert.deepStrictEqual(names, ['recent']);
        });

        test('returns the newest first and caps how many ARM calls a poll will make', () => {
            const deployments = [
                deployment('d1', 'Running', new Date('2026-01-01T10:01:00Z')),
                deployment('d2', 'Running', new Date('2026-01-01T10:03:00Z')),
                deployment('d3', 'Running', new Date('2026-01-01T10:02:00Z')),
            ];

            assert.deepStrictEqual(selectTrackedDeployments(deployments, { knownNames: [], since, limit: 2 }), ['d2', 'd3']);
        });

        test('skips deployments with no name', () => {
            assert.deepStrictEqual(selectTrackedDeployments([{ properties: { provisioningState: 'Running' } }], { knownNames: [], since, limit: 5 }), []);
        });
    });

    suite('buildResourceSummary', () => {
        test('counts completed resources against the total', () => {
            const summary = buildResourceSummary([
                { id: 'a', label: 'a', status: 'done' },
                { id: 'b', label: 'b', status: 'active' },
                { id: 'c', label: 'c', status: 'pending' },
            ]);

            assert.ok(summary?.includes('1'), `expected the summary to report 1 of 3, got: ${String(summary)}`);
            assert.ok(summary?.includes('3'), `expected the summary to report 1 of 3, got: ${String(summary)}`);
        });

        test('has nothing to report for an empty list', () => {
            assert.strictEqual(buildResourceSummary([]), undefined);
        });
    });

    suite('parseDeployTarget', () => {
        test('reads the identifiers needed to query ARM', () => {
            const target = parseDeployTarget(JSON.stringify({
                subscriptionId: '  sub-1  ',
                resourceGroupName: 'rg-office-dev',
                deploymentNames: ['dep-1', 3, '', 'dep-2'],
            }));

            assert.deepStrictEqual(target, {
                subscriptionId: 'sub-1',
                resourceGroupName: 'rg-office-dev',
                deploymentNames: ['dep-1', 'dep-2'],
            });
        });

        test('defaults deploymentNames to empty, which is the normal mid-deploy state', () => {
            const target = parseDeployTarget(JSON.stringify({ subscriptionId: 'sub-1', resourceGroupName: 'rg' }));
            assert.deepStrictEqual(target?.deploymentNames, []);
        });

        test('returns undefined when either identifier is missing or blank', () => {
            assert.strictEqual(parseDeployTarget(JSON.stringify({ resourceGroupName: 'rg' })), undefined);
            assert.strictEqual(parseDeployTarget(JSON.stringify({ subscriptionId: 'sub-1' })), undefined);
            assert.strictEqual(parseDeployTarget(JSON.stringify({ subscriptionId: '  ', resourceGroupName: 'rg' })), undefined);
        });

        test('returns undefined for a half-written or non-object file', () => {
            assert.strictEqual(parseDeployTarget('{"subscriptionId":'), undefined);
            assert.strictEqual(parseDeployTarget(''), undefined);
            assert.strictEqual(parseDeployTarget('null'), undefined);
            assert.strictEqual(parseDeployTarget('[]'), undefined);
        });
    });
});
