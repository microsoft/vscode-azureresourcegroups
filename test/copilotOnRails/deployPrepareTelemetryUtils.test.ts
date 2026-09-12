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
        const expected: DeployArtifactTelemetry = {
            parsedOk: true,
            serviceCount: 9,
            serviceTypes: 'applicationinsights,azureopenai,functions,keyvault,loganalyticsworkspace,postgresflexibleserver,staticwebapp,storageaccount,userassignedidentity',
            iacFormat: 'bicep',
            quotaVerified: false,
            insufficientQuotaCount: 0,
        };

        assert.deepStrictEqual(telemetry, expected);
    });

    test('attendance project uses service kinds and quota status', () => {
        const telemetry = loadPrepareTelemetry('copilotOnRails-attendance');
        const expected: DeployArtifactTelemetry = {
            parsedOk: true,
            serviceCount: 7,
            serviceTypes: 'applicationinsights,functions,loganalyticsworkspace,postgresflexibleserver,staticwebapp,storageaccount,userassignedidentity',
            iacFormat: 'bicep',
            quotaStatus: 'skipped',
        };

        assert.deepStrictEqual(telemetry, expected);
    });

    test('empty plan omits unavailable metrics', () => {
        assert.deepStrictEqual(getDeployArtifactTelemetry('prepare-plan.json', '{}'), { parsedOk: true });
    });

    test('reports invalid JSON without exposing parser errors', () => {
        for (const content of ['{"private@example.com":', 'null', '[]']) {
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
            iacFormat: 'unknown',
            insufficientQuotaCount: 1,
            healingAttemptCount: 1,
        });
    });
});

function loadPrepareTelemetry(workspaceFolderName: string): DeployArtifactTelemetry {
    const fixtureUri = Uri.joinPath(getWorkspaceFolderUri(workspaceFolderName), 'prepare-plan.json');
    return getDeployArtifactTelemetry('prepare-plan.json', fs.readFileSync(fixtureUri.fsPath, 'utf8'));
}
