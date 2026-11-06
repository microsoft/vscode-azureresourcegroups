/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { DeployArtifactTelemetry, getDeployArtifactTelemetry } from '../../src/webviews/copilotOnRails/extension/utils/deployArtifactTelemetryUtils';
import { getWorkspaceFolderUri } from '../testUtils';

suite('deployPrereqTelemetryUtils', () => {
    test('attendance project', () => {
        const telemetry = loadPrereqTelemetry('copilotOnRails-attendance');
        const expected: DeployArtifactTelemetry = {
            parsedOk: true,
            overallHealth: 'ready',
            componentCount: 3,
            componentArchitecture: '[{"role":"backend","type":"functions","runtime":"node","framework":"azure-functions"},{"role":"frontend","type":"spa","runtime":"node","framework":"react-vite"},{"role":"shared","type":"library","runtime":"node","framework":"unknown"}]',
            buildPassedCount: 3,
            buildFailedCount: 0,
            deployabilityPassedCount: 3,
            deployabilityFailedCount: 0,
            warningCount: 2,
            buildWarningCount: 0,
            completenessWarningCount: 0,
            deployabilityWarningCount: 0,
            f1Viable: false,
        };

        assert.deepStrictEqual(telemetry, expected);
        assert.doesNotMatch(telemetry.componentArchitecture ?? '', /attendance|services\//i);
    });

    test('empty prereq omits unavailable metrics', () => {
        assert.deepStrictEqual(getDeployArtifactTelemetry('prereq-output.json', '{}'), { parsedOk: true });
    });

    test('reports invalid JSON without exposing parser errors', () => {
        for (const content of ['{"private@example.com":', 'null', '[]']) {
            assert.deepStrictEqual(getDeployArtifactTelemetry('prereq-output.json', content), { parsedOk: false });
        }
    });

    test('ignores malformed collections and boolean strings', () => {
        const telemetry = getDeployArtifactTelemetry('prereq-output.json', JSON.stringify({
            components: [null],
            warnings: [{ axis: 'build' }, false],
            fastTrackEligible: 'false',
            buildRequirements: { hasDockerfile: 'true', hasNativeModules: 1, f1Viable: null },
        }));

        assert.deepStrictEqual(telemetry, { parsedOk: true });
    });

    test('does not emit unknown health values or warning text', () => {
        const telemetry = getDeployArtifactTelemetry('prereq-output.json', JSON.stringify({
            overallHealth: 'private@example.com',
            warnings: [{ axis: 'private-axis', summary: 'Private summary', detail: 'Private details', fix: 'private-command' }],
        }));

        assert.deepStrictEqual(telemetry, {
            parsedOk: true,
            overallHealth: 'unknown',
            warningCount: 1,
            buildWarningCount: 0,
            completenessWarningCount: 0,
            deployabilityWarningCount: 0,
        });
    });

    test('serializes only bounded architecture categories', () => {
        const telemetry = getDeployArtifactTelemetry('prereq-output.json', JSON.stringify({
            components: [{
                id: 'private-service-name',
                path: 'C:\\private\\project',
                role: 'private-role',
                kind: 'private-kind',
                runtime: 'private-runtime',
                framework: 'Private Framework',
                verdicts: { build: { status: 'Private status' } },
            }],
        }));

        assert.strictEqual(telemetry.componentArchitecture, '[{"role":"unknown","type":"unknown","runtime":"unknown","framework":"unknown"}]');
        assert.doesNotMatch(JSON.stringify(telemetry), /private|C:\\\\/i);
    });
});

function loadPrereqTelemetry(workspaceFolderName: string): DeployArtifactTelemetry {
    const fixtureUri = Uri.joinPath(getWorkspaceFolderUri(workspaceFolderName), 'prereq-output.json');
    return getDeployArtifactTelemetry('prereq-output.json', fs.readFileSync(fixtureUri.fsPath, 'utf8'));
}
