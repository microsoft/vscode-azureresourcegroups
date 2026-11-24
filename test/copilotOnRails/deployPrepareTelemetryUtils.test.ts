/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { DeployArtifactTelemetry, getDeployArtifactTelemetry } from '../../src/webviews/copilotOnRails/extension/utils/deployArtifactTelemetryUtils';
import { getWorkspaceFolderUri } from '../testUtils';

suite('deployPrepareTelemetryUtils', () => {
    test('scrapbook project', () => {
        const telemetry = loadPrepareTelemetry('copilotOnRails-scrapbook');
        const { serviceArchitecture, ...summary } = telemetry;
        const expected: DeployArtifactTelemetry = {
            parsedOk: true,
            serviceCount: 9,
            serviceTypes: 'applicationinsights,azureopenai,functions,keyvault,loganalyticsworkspace,postgresflexibleserver,staticwebapp,storageaccount,userassignedidentity',
            iacFormat: 'bicep',
            quotaVerified: false,
            insufficientQuotaCount: 0,
        };

        assert.deepStrictEqual(summary, expected);
        assert.strictEqual((JSON.parse(serviceArchitecture ?? '[]') as unknown[]).length, 9);
    });

    test('attendance project uses service kinds and quota status', () => {
        const telemetry = loadPrepareTelemetry('copilotOnRails-attendance');
        const { serviceArchitecture, ...summary } = telemetry;
        const expected: DeployArtifactTelemetry = {
            parsedOk: true,
            serviceCount: 7,
            serviceTypes: 'applicationinsights,functions,loganalyticsworkspace,postgresflexibleserver,staticwebapp,storageaccount,userassignedidentity',
            iacFormat: 'bicep',
            quotaStatus: 'skipped',
        };

        assert.deepStrictEqual(summary, expected);
        assert.deepStrictEqual(JSON.parse(serviceArchitecture ?? '[]'), [
            { role: 'backend', type: 'functions', runtime: 'node', framework: 'unknown' },
            { role: 'frontend', type: 'staticwebapp', runtime: 'unknown', framework: 'unknown' },
            { role: 'database', type: 'postgresflexibleserver', runtime: 'unknown', framework: 'unknown' },
            { role: 'unknown', type: 'storageaccount', runtime: 'unknown', framework: 'unknown' },
            { role: 'unknown', type: 'loganalyticsworkspace', runtime: 'unknown', framework: 'unknown' },
            { role: 'unknown', type: 'applicationinsights', runtime: 'unknown', framework: 'unknown' },
            { role: 'unknown', type: 'userassignedidentity', runtime: 'unknown', framework: 'unknown' },
        ]);
    });

    test('empty plan omits unavailable metrics', () => {
        assert.deepStrictEqual(getDeployArtifactTelemetry('prepare-plan.json', '{}'), { parsedOk: true });
    });

    test('reports invalid JSON without exposing parser errors', () => {
        for (const content of ['{"private@example.com":', 'null', '[]', '"plan"', '42', 'true']) {
            assert.deepStrictEqual(getDeployArtifactTelemetry('prepare-plan.json', content), { parsedOk: false });
        }
    });

    test('only emits known service types, quota outcomes and healing counts', () => {
        const telemetry = getDeployArtifactTelemetry('prepare-plan.json', JSON.stringify({
            services: [{ name: 'Functions', resourceName: 'private-api' }, { name: 'functions-private-customer' }],
            iacFormat: '/private/template',
            quotaValidation: { verified: 'true', reason: 'Private details' },
            quotas: [{ sufficient: false }, { sufficient: true }, { sufficient: 'false' }],
            healingAttempts: [{ reason: 'Private details', action: 'private-command' }],
            costEstimate: { currency: 'USD', monthlyUsd: 18.1 },
            deploymentVariables: { deployedBy: 'private@example.com' },
        }));

        assert.deepStrictEqual(telemetry, {
            parsedOk: true,
            serviceCount: 2,
            serviceTypes: 'functions,unknown',
            serviceArchitecture: '[{"role":"backend","type":"functions","runtime":"unknown","framework":"unknown"},{"role":"unknown","type":"unknown","runtime":"unknown","framework":"unknown"}]',
            iacFormat: 'unknown',
            insufficientQuotaCount: 1,
            healingAttemptCount: 1,
        });
        assert.doesNotMatch(telemetry.serviceArchitecture ?? '', /private|resourceName/i);
    });
});

function loadPrepareTelemetry(workspaceFolderName: string): DeployArtifactTelemetry {
    const fixtureUri = Uri.joinPath(getWorkspaceFolderUri(workspaceFolderName), 'prepare-plan.json');
    return getDeployArtifactTelemetry('prepare-plan.json', fs.readFileSync(fixtureUri.fsPath, 'utf8'));
}
