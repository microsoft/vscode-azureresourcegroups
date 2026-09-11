/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTestActionContext } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as vscode from 'vscode';
import { ensureRequiredCopilotOnRailsContext } from '../../src/utils/copilotOnRails/CopilotOnRailsContext';
import { recordDeployArtifactsTelemetry } from '../../src/webviews/copilotOnRails/extension/utils/deployArtifactTelemetryUtils';
import { getWorkspaceFolderUri } from '../testUtils';

suite('recordDeployArtifactsTelemetry', () => {
    test('records properties from each artifact in diagnostics and telemetry', async () => {
        const resultFile = vscode.Uri.joinPath(getWorkspaceFolderUri('copilotOnRails-attendance'), 'deploy-result.json');
        const context = ensureRequiredCopilotOnRailsContext(await createTestActionContext());

        await recordDeployArtifactsTelemetry(context, resultFile);

        assert.strictEqual(context.diagnostics.properties['prereqOutput.overallHealth'], 'ready');
        assert.strictEqual(context.telemetry.properties['prereqOutput.overallHealth'], 'ready');

        assert.strictEqual(context.diagnostics.properties['preparePlan.serviceCount'], 7);
        assert.strictEqual(context.telemetry.properties['preparePlan.serviceCount'], '7');

        assert.strictEqual(context.diagnostics.properties['scaffoldManifest.validationStatus'], 'PASS');
        assert.strictEqual(context.telemetry.properties['scaffoldManifest.validationStatus'], 'PASS');

        assert.strictEqual(context.diagnostics.properties['deployResult.partial'], false);
        assert.strictEqual(context.telemetry.properties['deployResult.partial'], 'false');
    });

    test('skips missing files and properties while preserving explicit false and zero values', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'deploy-telemetry-'));
        try {
            const sourceFile = vscode.Uri.file(join(directory, 'deploy-result.json'));
            await vscode.workspace.fs.writeFile(sourceFile, Buffer.from('{"status":"failed","partial":false}'));
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(sourceFile, '..', 'prereq-output.json'),
                Buffer.from('{"components":[],"buildRequirements":{}}'));
            const context = ensureRequiredCopilotOnRailsContext(await createTestActionContext());
            const existingTelemetry = { ...context.telemetry.properties };

            await recordDeployArtifactsTelemetry(context, sourceFile);

            const expected = {
                'prereqOutput.parsedOk': true,
                'prereqOutput.componentCount': 0,
                'deployResult.parsedOk': true,
                'deployResult.status': 'failed',
                'deployResult.partial': false,
            };
            assert.deepStrictEqual(context.diagnostics.properties, expected);
            assert.deepStrictEqual(context.telemetry.properties, {
                ...existingTelemetry,
                ...Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, String(value)])),
            });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('a missing final result or status leaves existing properties unchanged', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'deploy-telemetry-'));
        try {
            const sourceFile = vscode.Uri.file(join(directory, 'deploy-result.json'));
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(sourceFile, '..', 'prereq-output.json'), Buffer.from('{}'));
            for (const content of [undefined, '{}']) {
                if (content !== undefined) {
                    await vscode.workspace.fs.writeFile(sourceFile, Buffer.from(content));
                }
                const context = ensureRequiredCopilotOnRailsContext(await createTestActionContext());
                const existingDiagnostics = { ...context.diagnostics.properties };
                const existingTelemetry = { ...context.telemetry.properties };

                await recordDeployArtifactsTelemetry(context, sourceFile);

                assert.deepStrictEqual(context.diagnostics.properties, existingDiagnostics);
                assert.deepStrictEqual(context.telemetry.properties, existingTelemetry);
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('records fixed parse and read failure properties without leaking source values', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'deploy-telemetry-'));
        try {
            const sourceFile = vscode.Uri.file(join(directory, 'deploy-result.json'));
            await vscode.workspace.fs.writeFile(sourceFile, Buffer.from('{"status":"succeeded"}'));
            await vscode.workspace.fs.writeFile(vscode.Uri.file(join(directory, 'prereq-output.json')), Buffer.from('{"private@example.com":'));
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(join(directory, 'scaffold-manifest.json')));
            const context = ensureRequiredCopilotOnRailsContext(await createTestActionContext());
            await recordDeployArtifactsTelemetry(context, sourceFile);
            const expected = {
                'prereqOutput.parsedOk': false, 'scaffoldManifest.readFailed': true,
                'deployResult.parsedOk': true, 'deployResult.status': 'succeeded',
            };
            assert.deepStrictEqual(context.diagnostics.properties, expected);
            for (const [key, value] of Object.entries(expected)) {
                assert.strictEqual(context.telemetry.properties[key], String(value));
            }
            assert.ok(!JSON.stringify(context.diagnostics.properties).includes(directory));
            assert.ok(!JSON.stringify(context.telemetry.properties).includes('private@example.com'));
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
