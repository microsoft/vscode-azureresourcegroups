/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import type { McpProviderOptions } from '@microsoft/vscode-inproc-mcp/vscode';
import * as vscode from 'vscode';
import { LoopbackPrototypeLifecycle } from './loopbackPrototypeLifecycle';
import type { LoopbackOptions } from './loopbackTypes';
import { markerCommandId } from './toolCatalog';

const commandPrefix = 'azureResourceGroups.experimentalMcpHttp';
let lifecycle: LoopbackPrototypeLifecycle | undefined;
let serverLabel = '';

export interface LoopbackProviderOptions extends Pick<McpProviderOptions, 'id' | 'serverLabel' | 'serverVersion'> {
    registerTools: LoopbackOptions['registerTools'];
}

export function getLoopbackPrototypeDefinition(): vscode.McpHttpServerDefinition | undefined {
    const listener = lifecycle?.listener;
    return listener ? new vscode.McpHttpServerDefinition(
        serverLabel,
        vscode.Uri.parse(listener.url.href),
        { ...listener.headers },
        listener.instanceId,
    ) : undefined;
}

export async function stopLoopbackPrototype(): Promise<void> {
    await lifecycle?.stop();
}

export async function registerLoopbackPrototype(
    context: vscode.ExtensionContext,
    options: LoopbackProviderOptions,
): Promise<void> {
    serverLabel = options.serverLabel;
    const output = vscode.window.createOutputChannel('Azure Resources MCP HTTP Prototype', { log: true });
    const changed = new vscode.EventEmitter<void>();
    const marker = randomUUID();
    let disposed = false;
    const trusted = (): boolean => vscode.workspace.isTrusted && !vscode.env.remoteName
        && vscode.workspace.workspaceFolders?.length === 1
        && vscode.workspace.workspaceFolders[0].uri.scheme === 'file';
    const reportFailure = (): void => {
        output.error('Prototype listener startup or shutdown failed');
        if (!disposed) {
            void vscode.window.showErrorMessage(vscode.l10n.t('The MCP HTTP prototype could not start or stop. See the Azure Resources MCP HTTP Prototype output channel.'));
        }
    };
    lifecycle = new LoopbackPrototypeLifecycle({
        id: options.id,
        version: options.serverVersion,
        registerTools: options.registerTools,
        isEligible: trusted,
        onChanged: () => changed.fire(),
        onStarted: () => output.info(`Prototype ready. Window marker: ${marker}. Credential and endpoint omitted.`),
        onInfo: message => output.info(message),
        onError: message => output.error(message),
        onFailure: reportFailure,
    });
    context.subscriptions.push(output, changed);
    context.subscriptions.push(vscode.commands.registerCommand(markerCommandId, () => {
        if (!lifecycle?.listener || !trusted()) {
            throw new Error('A running prototype and one trusted local folder are required');
        }
        output.info(`Fixed marker command invoked: ${marker}`);
        return marker;
    }));
    context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider(options.id, {
        onDidChangeMcpServerDefinitions: changed.event,
        provideMcpServerDefinitions: () => {
            const definition = getLoopbackPrototypeDefinition();
            return definition ? [definition] : [];
        },
    }));
    context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => {
        void lifecycle?.start().catch(reportFailure);
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void lifecycle?.restart().catch(reportFailure);
    }));
    context.subscriptions.push({ dispose: () => {
        disposed = true;
        void lifecycle?.dispose().catch(reportFailure);
    } });
    context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.enable`, async () => {
        if (disposed || !trusted()) {
            throw new Error('The MCP HTTP prototype requires one trusted local folder.');
        }
        await lifecycle?.enable();
    }));
    context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.stop`, async () => {
        await lifecycle?.disable();
    }));
    await vscode.commands.executeCommand('setContext', commandPrefix, true);
    output.info('Experimental HTTP is the default on this branch. Credentials may be stored in VS Code Agent Host configuration.');
    if (!trusted()) {
        output.info('Waiting for one trusted local folder before starting the HTTP listener.');
    }
    await lifecycle.start();
}
