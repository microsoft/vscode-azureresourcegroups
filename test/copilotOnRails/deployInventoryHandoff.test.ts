/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTestActionContext } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import * as vscode from 'vscode';
import { ensureRequiredCopilotOnRailsContext } from '../../src/utils/copilotOnRails/CopilotOnRailsContext';
import { recordDeployArtifactsTelemetry } from '../../src/webviews/copilotOnRails/extension/utils/deployArtifactTelemetryUtils';
import { createMockAzureResourcesServiceFactory, createMockSubscriptionWithFunctions } from '../api/mockServiceFactory';
import { getWorkspaceFolderUri } from '../testUtils';
import { getCachedTestApi } from '../utils/testApiAccess';

suite('deployInventoryHandoff', () => {
    test('overlapping view handoffs wait for inventory before telemetry reads the result', async () => {
        const api = getCachedTestApi();
        const resources = createMockSubscriptionWithFunctions();
        const service = createMockAzureResourcesServiceFactory(resources)();
        const workspace = getWorkspaceFolderUri('testWorkspace');
        const workspaceExisted = existsSync(workspace.fsPath);
        const sessionId = randomUUID();
        const session = vscode.Uri.joinPath(workspace, '.copilot-azure', 'sessions', sessionId);
        const resultFile = vscode.Uri.joinPath(session, 'deploy-result.json');
        const handoffs: Thenable<vscode.Uri | undefined>[] = [];
        let releaseCapture: (() => void) | undefined;
        let signalCaptureStarted: (() => void) | undefined;
        const captureStarted = new Promise<void>(resolve => { signalCaptureStarted = resolve; });
        const captureReleased = new Promise<void>(resolve => { releaseCapture = resolve; });
        let captureCount = 0;
        api.testing.setOverrideAzureServiceFactory(() => ({
            ...service,
            listResources: async (context, subscription) => {
                captureCount++;
                signalCaptureStarted?.();
                await captureReleased;
                return service.listResources(context, subscription);
            },
            listDeploymentOperations: async () => ({
                operations: [{
                    properties: {
                        targetResource: { id: resources.functionApp1.id },
                        provisioningState: 'Succeeded',
                    },
                }],
            }),
        }));

        try {
            await vscode.workspace.fs.createDirectory(session);
            await vscode.workspace.fs.writeFile(resultFile, Buffer.from(JSON.stringify({
                sessionId,
                subscriptionId: resources.sub1.subscriptionId,
                resourceGroupName: resources.sub1.rg1.name,
                deploymentNames: ['test-deploy'],
                status: 'succeeded',
            })));
            handoffs.push(vscode.commands.executeCommand('copilotOnRails.openDeployResultView'));
            await captureStarted;
            handoffs.push(vscode.commands.executeCommand('copilotOnRails.openDeployResultView'));

            // Neither caller may finish while the simulated Azure request is still blocked.
            const outcome = await Promise.race([
                Promise.race(handoffs).then(() => 'returned-before-capture'),
                new Promise<string>(resolve => setTimeout(() => resolve('waiting-for-capture'), 100)),
            ]);
            assert.strictEqual(outcome, 'waiting-for-capture');

            releaseCapture?.();
            for (const uri of await Promise.all(handoffs)) {
                assert.strictEqual(uri?.toString(), resultFile.toString());
                const context = ensureRequiredCopilotOnRailsContext(await createTestActionContext());
                await recordDeployArtifactsTelemetry(context, resultFile);
                assert.strictEqual(context.diagnostics.properties['deployResult.createdResourceCount'], 1);
                assert.strictEqual(context.telemetry.properties['deployResult.createdResourceCount'], '1');
            }
            assert.strictEqual(captureCount, 1);
        } finally {
            releaseCapture?.();
            await Promise.all(handoffs);
            api.testing.setOverrideAzureServiceFactory(undefined);
            api.testing.setOverrideAzureSubscriptionProvider(undefined);
            await vscode.workspace.fs.delete(workspaceExisted ? session : workspace, { recursive: true });
        }
    });
});
