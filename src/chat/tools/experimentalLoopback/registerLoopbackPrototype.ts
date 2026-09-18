/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { McpProviderOptions } from '@microsoft/vscode-inproc-mcp/vscode';
import * as vscode from 'vscode';
import { startLoopbackServer, type LoopbackListener, type RegisterTools } from './loopbackServer';

let listener: LoopbackListener | undefined;
let serverLabel = '';
let disposed = false;
let transition = Promise.resolve();

export interface LoopbackProviderOptions extends Pick<McpProviderOptions, 'id' | 'serverLabel' | 'serverVersion'> {
    registerTools: RegisterTools;
}

export function getLoopbackPrototypeDefinition(): vscode.McpHttpServerDefinition | undefined {
    return listener && new vscode.McpHttpServerDefinition(
        serverLabel,
        vscode.Uri.parse(listener.url.href),
        { ...listener.headers },
        listener.instanceId,
    );
}

export async function stopLoopbackPrototype(): Promise<void> {
    disposed = true;
    const stop = async (): Promise<void> => {
        await listener?.dispose();
        listener = undefined;
    };
    transition = transition.then(stop, stop);
    await transition;
}

export async function registerLoopbackPrototype(
    context: vscode.ExtensionContext,
    options: LoopbackProviderOptions,
): Promise<void> {
    serverLabel = options.serverLabel;
    disposed = false;

    const output = vscode.window.createOutputChannel('Azure Resources MCP HTTP Prototype', { log: true });
    const changed = new vscode.EventEmitter<void>();
    const canRun = (): boolean => vscode.workspace.isTrusted && !vscode.env.remoteName;
    const reportFailure = (error: unknown): void => {
        output.error(`Prototype listener failed: ${error instanceof Error ? error.message : String(error)}`);
        if (!disposed) {
            void vscode.window.showErrorMessage(vscode.l10n.t('The MCP HTTP prototype failed. See the Azure Resources MCP HTTP Prototype output channel.'));
        }
    };
    const restart = (): Promise<void> => {
        const replace = async (): Promise<void> => {
            await listener?.dispose();
            listener = undefined;
            changed.fire();

            if (disposed || !canRun()) {
                return;
            }

            listener = await startLoopbackServer({
                id: options.id,
                version: options.serverVersion,
                registerTools: options.registerTools,
                onError: message => output.error(message),
            });
            output.info('Prototype ready. Credential and endpoint omitted.');
            changed.fire();
        };
        // Close the old listener before publishing a replacement.
        transition = transition.then(replace, replace);
        return transition;
    };

    context.subscriptions.push(
        output,
        changed,
        vscode.lm.registerMcpServerDefinitionProvider(options.id, {
            onDidChangeMcpServerDefinitions: changed.event,
            provideMcpServerDefinitions: () => {
                const definition = getLoopbackPrototypeDefinition();
                return definition ? [definition] : [];
            },
        }),
        vscode.workspace.onDidGrantWorkspaceTrust(() => void restart().catch(reportFailure)),
        { dispose: () => void stopLoopbackPrototype().catch(reportFailure) },
    );

    output.info('Experimental HTTP starts automatically in a trusted local window.');
    if (!canRun()) {
        output.info('Waiting for Workspace Trust in a local window.');
    }
    await restart();
}
