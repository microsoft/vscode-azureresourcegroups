/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { DeployArtifactTelemetry, getDeployArtifactTelemetry } from '../../src/webviews/copilotOnRails/extension/utils/deployArtifactTelemetryUtils';
import { getWorkspaceFolderUri } from '../testUtils';

suite('deployScaffoldTelemetryUtils', () => {
    test('attendance project', () => {
        const telemetry = loadScaffoldTelemetry('copilotOnRails-attendance');
        const expected: DeployArtifactTelemetry = {
            parsedOk: true,
            iacFormat: 'bicep',
            fileCount: 11,
            validationStatus: 'PASS',
            validationWarningCount: 1,
            validationErrorCount: 0,
            conformanceStatus: 'PASS-INFERRED',
            flaggedFindingCount: 0,
        };

        assert.deepStrictEqual(telemetry, expected);
    });

    test('empty manifest omits unavailable metrics', () => {
        assert.deepStrictEqual(getDeployArtifactTelemetry('scaffold-manifest.json', '{}'), { parsedOk: true });
    });

    test('reports invalid JSON without exposing parser errors', () => {
        for (const content of ['{"private@example.com":', 'null', '[]']) {
            assert.deepStrictEqual(getDeployArtifactTelemetry('scaffold-manifest.json', content), { parsedOk: false });
        }
    });

    test('ignores malformed collections and boolean strings', () => {
        const telemetry = getDeployArtifactTelemetry('scaffold-manifest.json', JSON.stringify({
            files: 'private',
            validationResult: { checks: [null] },
            conformance: { passed: 'true' },
        }));

        assert.deepStrictEqual(telemetry, { parsedOk: true });
    });

    test('only emits known validation categories and exact boolean outcomes', () => {
        const telemetry = getDeployArtifactTelemetry('scaffold-manifest.json', JSON.stringify({
            iacFormat: '/private/template',
            targetScope: 'private@example.com',
            validationResult: {
                status: 'Private validation summary',
                checks: [{ passed: true }, { passed: false }, { passed: 'true' }],
                proof: 'Private command output',
            },
        }));

        assert.deepStrictEqual(telemetry, {
            parsedOk: true,
            iacFormat: 'unknown',
            targetScope: 'unknown',
            validationStatus: 'unknown',
            validationPassedCount: 1,
            validationFailedCount: 1,
        });
    });
});

function loadScaffoldTelemetry(workspaceFolderName: string): DeployArtifactTelemetry {
    const fixtureUri = Uri.joinPath(getWorkspaceFolderUri(workspaceFolderName), 'scaffold-manifest.json');
    return getDeployArtifactTelemetry('scaffold-manifest.json', fs.readFileSync(fixtureUri.fsPath, 'utf8'));
}
