/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { mcpServerId, mcpServerLabel } from '../../../constants';
import type { LoopbackListener, LoopbackOptions } from './loopbackServer';
import { markerCommandId } from './toolCatalog';

export const prototypeEnvironmentKey = 'AZURE_RESOURCES_MCP_HTTP_PROTOTYPE';
const commandPrefix = 'azureResourceGroups.experimentalMcpHttp';
let activeListener: LoopbackListener | undefined;
let generation = 0;

export function getLoopbackPrototypeDefinition(): vscode.McpHttpServerDefinition | undefined {
    return activeListener ? new vscode.McpHttpServerDefinition(
        mcpServerLabel,
        vscode.Uri.parse(activeListener.url.href),
        { ...activeListener.headers },
        activeListener.instanceId,
    ) : undefined;
}

export async function stopLoopbackPrototype(): Promise<void> {
    generation++;
    const listener = activeListener;
    activeListener = undefined;
    await listener?.dispose();
}

export async function registerLoopbackPrototype(
    context: vscode.ExtensionContext,
    registerTools: LoopbackOptions['registerTools'],
    version: string,
): Promise<boolean> {
    if (process.env[prototypeEnvironmentKey] !== '1' || context.extensionMode === vscode.ExtensionMode.Production) {
        return false;
    }
    const output = vscode.window.createOutputChannel('Azure Resources MCP HTTP Prototype', { log: true });
    const changed = new vscode.EventEmitter<void>();
    const marker = randomUUID();
    let disposed = false;
    let enabling = false;
    const trusted = (): boolean => vscode.workspace.isTrusted && !vscode.env.remoteName
        && vscode.workspace.workspaceFolders?.length === 1
        && vscode.workspace.workspaceFolders[0].uri.scheme === 'file';
    context.subscriptions.push(output, changed);
    context.subscriptions.push(vscode.commands.registerCommand(markerCommandId, () => {
        if (!activeListener || !trusted()) {
            throw new Error('An enabled prototype and one trusted local folder are required');
        }
        output.info(`Fixed marker command invoked: ${marker}`);
        return marker;
    }));
    context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider(mcpServerId, {
        onDidChangeMcpServerDefinitions: changed.event,
        provideMcpServerDefinitions: () => {
            const definition = getLoopbackPrototypeDefinition();
            return definition ? [definition] : [];
        },
    }));
    const reportStop = (): void => {
        void stopLoopbackPrototype().catch(() => output.error('Prototype listener shutdown failed'));
    };
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(reportStop));
    context.subscriptions.push({ dispose: () => { disposed = true; reportStop(); } });
    context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.enable`, async () => {
        if (enabling || activeListener) {
            void vscode.window.showInformationMessage('The MCP HTTP prototype is already enabled or awaiting approval.');
            return;
        }
        if (disposed || !trusted()) {
            throw new Error('The MCP HTTP prototype requires one trusted local folder and a development extension host.');
        }
        enabling = true;
        const startGeneration = generation;
        try {
            const selection = await vscode.window.showWarningMessage(
                vscode.l10n.t('Enable the experimental loopback MCP listener for 30 minutes? VS Code may write its short-lived credential into Agent Host plugin configuration. Only the marker and Scaffold Next Steps tools are exposed. Do not click workflow actions.'),
                { modal: true },
                'Enable for this window',
            );
            if (selection !== 'Enable for this window' || disposed || !trusted() || startGeneration !== generation) {
                return;
            }
            const { startLoopbackServer } = await import('./loopbackServer.js');
            if (disposed || !trusted() || startGeneration !== generation) {
                return;
            }
            const listener = await startLoopbackServer({
                id: mcpServerId,
                version,
                registerTools,
                onError: message => output.error(message),
                onDispose: () => {
                    if (activeListener === listener) {
                        activeListener = undefined;
                    }
                    if (!disposed) {
                        changed.fire();
                        output.info('Prototype credential revoked and listener stopped');
                    }
                },
            });
            if (disposed || !trusted() || startGeneration !== generation) {
                await listener.dispose();
                return;
            }
            activeListener = listener;
            changed.fire();
            output.info(`Prototype ready. Window marker: ${marker}. Credential and endpoint omitted.`);
        } finally {
            enabling = false;
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.stop`, async () => {
        await stopLoopbackPrototype();
    }));
    await vscode.commands.executeCommand('setContext', commandPrefix, true);
    output.info('Prototype available but disabled. Run Enable MCP HTTP Prototype to approve this window.');
    return true;
}
