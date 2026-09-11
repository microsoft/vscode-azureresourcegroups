/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { DeployArtifactTelemetry, getDeployArtifactTelemetry } from '../../src/webviews/copilotOnRails/extension/utils/deployArtifactTelemetryUtils';
import { getWorkspaceFolderUri } from '../testUtils';

suite('deployResultTelemetryUtils', () => {
    test('scrapbook project uses endpoint maps and top-level timestamps', () => {
        const telemetry = loadResultTelemetry('copilotOnRails-scrapbook');
        const expected: DeployArtifactTelemetry = {
            parsedOk: true,
            status: 'succeeded',
            healthStatus: 'healthy',
            durationSeconds: 152353,
            endpointCount: 3,
            healingAttemptCount: 4,
        };

        assert.deepStrictEqual(telemetry, expected);
    });

    test('attendance project uses the documented array layout', () => {
        const telemetry = loadResultTelemetry('copilotOnRails-attendance');
        const expected: DeployArtifactTelemetry = {
            parsedOk: true,
            status: 'succeeded',
            healthStatus: 'healthy',
            partial: false,
            durationSeconds: 2981,
            endpointCount: 2,
            healthyEndpointCount: 2,
            failedResourceCount: 0,
            createdResourceCount: 9,
            orphanedResourceCount: 9,
            unverifiedResourceCount: 0,
            inventoryUnverified: false,
            healingAttemptCount: 4,
        };

        assert.deepStrictEqual(telemetry, expected);
    });

    test('schema layout records failure, endpoint health and inventory counts', () => {
        const telemetry = getDeployArtifactTelemetry('deploy-result.json', JSON.stringify({
            status: 'failed',
            healthStatus: 'degraded',
            partial: true,
            duration: { startedUtc: '2026-09-11T10:00:00Z', completedUtc: '2026-09-11T10:02:00.250Z' },
            endpoints: [
                { healthStatus: 'healthy', url: 'https://private.example/api' },
                { healthStatus: 'unreachable', url: 'https://private.example/web' },
            ],
            resourceResults: [{ status: 'failed', resourceId: '/subscriptions/private', error: 'Private error details' }],
            createdResources: [{ classification: 'orphaned' }, { classification: 'unverified' }],
            inventoryUnverified: true,
            healingAttempts: [{ detail: 'Private healing details' }],
        }));
        const expected: DeployArtifactTelemetry = {
            parsedOk: true,
            status: 'failed',
            healthStatus: 'degraded',
            partial: true,
            durationSeconds: 120.25,
            endpointCount: 2,
            healthyEndpointCount: 1,
            failedResourceCount: 1,
            createdResourceCount: 2,
            orphanedResourceCount: 1,
            unverifiedResourceCount: 1,
            inventoryUnverified: true,
            healingAttemptCount: 1,
        };

        assert.deepStrictEqual(telemetry, expected);
    });

    test('empty result omits unavailable metrics', () => {
        assert.deepStrictEqual(getDeployArtifactTelemetry('deploy-result.json', '{}'), { parsedOk: true });
        assert.deepStrictEqual(getDeployArtifactTelemetry('deploy-result.json', '{"endpoints":[],"partial":false}'), {
            parsedOk: true, endpointCount: 0, healthyEndpointCount: 0, partial: false,
        });
    });

    test('reports invalid JSON without exposing parser errors', () => {
        for (const content of ['{"private@example.com":', 'null', '[]']) {
            assert.deepStrictEqual(getDeployArtifactTelemetry('deploy-result.json', content), { parsedOk: false });
        }
    });

    test('omits invalid or unfinished durations', () => {
        for (const completedUtc of ['private', '2026-02-30T10:00:00Z', '2026-09-11', '2026-09-11T09:00:00Z']) {
            const telemetry = getDeployArtifactTelemetry('deploy-result.json', JSON.stringify({
                status: 'succeeded',
                duration: { startedUtc: '2026-09-11T10:00:00Z', completedUtc },
            }));
            assert.strictEqual(telemetry.durationSeconds, undefined);
        }
        const telemetry = getDeployArtifactTelemetry('deploy-result.json', JSON.stringify({
            status: 'in-progress',
            duration: { startedUtc: '2026-09-11T10:00:00Z', completedUtc: '2026-09-11T10:01:00Z' },
        }));
        assert.strictEqual(telemetry.durationSeconds, undefined);
    });

    test('does not emit unknown statuses, endpoint names or URLs', () => {
        const telemetry = getDeployArtifactTelemetry('deploy-result.json', JSON.stringify({
            status: 'private@example.com',
            healthStatus: 'Private health summary',
            endpoints: { 'private-app': { url: 'https://private.example', healthStatus: 'Private probe output' } },
            partial: 'true',
            inventoryUnverified: 'false',
            warnings: ['Private warning'],
            subscriptionId: 'private-subscription',
            resourceGroupName: 'private-group',
        }));

        assert.deepStrictEqual(telemetry, {
            parsedOk: true,
            status: 'unknown',
            healthStatus: 'unknown',
            endpointCount: 1,
            healthyEndpointCount: 0,
        });
    });
});

function loadResultTelemetry(workspaceFolderName: string): DeployArtifactTelemetry {
    const fixtureUri = Uri.joinPath(getWorkspaceFolderUri(workspaceFolderName), 'deploy-result.json');
    return getDeployArtifactTelemetry('deploy-result.json', fs.readFileSync(fixtureUri.fsPath, 'utf8'));
}
