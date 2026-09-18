/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { McpProviderOptions } from '@microsoft/vscode-inproc-mcp/vscode';
import * as vscode from 'vscode';
import { startLoopbackServer, type LoopbackListener, type RegisterTools } from './loopbackServer';

let listener: LoopbackListener | undefined;
let disposed = false;
let starting: Promise<void> | undefined;

export interface LoopbackProviderOptions extends Pick<McpProviderOptions, 'id' | 'serverLabel' | 'serverVersion'> {
    registerTools: RegisterTools;
}

export async function stopLoopbackPrototype(): Promise<void> {
    disposed = true;
    await starting;
    await listener?.dispose();
    listener = undefined;
}

export async function registerLoopbackPrototype(
    context: vscode.ExtensionContext,
    options: LoopbackProviderOptions,
): Promise<void> {
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
    const startIfNeeded = async (): Promise<void> => {
        if (disposed || listener || !canRun()) {
            return;
        }
        starting ??= (async () => {
            const started = await startLoopbackServer({
                id: options.id,
                version: options.serverVersion,
                registerTools: options.registerTools,
                onError: message => output.error(message),
            });
            if (disposed) {
                await started.dispose();
                return;
            }
            listener = started;
            output.info('Prototype ready. Credential and endpoint omitted.');
            changed.fire();
        })();
        try {
            await starting;
        } finally {
            starting = undefined;
        }
    };

    context.subscriptions.push(
        output,
        changed,
        vscode.lm.registerMcpServerDefinitionProvider(options.id, {
            onDidChangeMcpServerDefinitions: changed.event,
            provideMcpServerDefinitions: () => {
                const definition = listener && new vscode.McpHttpServerDefinition(
                    options.serverLabel,
                    vscode.Uri.parse(listener.url.href),
                    { ...listener.headers },
                    listener.instanceId,
                );
                return definition ? [definition] : [];
            },
        }),
        vscode.workspace.onDidGrantWorkspaceTrust(() => void startIfNeeded().catch(reportFailure)),
        { dispose: () => void stopLoopbackPrototype().catch(reportFailure) },
    );

    output.info('Experimental HTTP starts automatically in a trusted local window.');
    if (!canRun()) {
        output.info('Waiting for Workspace Trust in a local window.');
    }
    await startIfNeeded();
}
