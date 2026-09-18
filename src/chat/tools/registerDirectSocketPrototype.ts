/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type McpProviderOptions, registerMcpHttpProvider } from '@microsoft/vscode-inproc-mcp/vscode';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { mcpServerId, mcpServerLabel } from '../../constants';
import { ext } from '../../extensionVariables';
import { isScaffoldNextStepsViewOpen } from '../../webviews/copilotOnRails/extension/openScaffoldNextStepsView';
import { openScaffoldNextStepsViewTool } from './copilotOnRails/openScaffoldNextStepsViewTool';
import { createDirectSocketPrototypeProvider, type DirectSocketPrototypeCounters } from './directSocketPrototype';
import { prototypeIdentityCommand, registerDirectSocketPrototypeTools } from './directSocketPrototypeTools';

const diagnosticsCommand = 'copilotOnRails.prototype1.diagnostics';

export function registerDirectSocketPrototype(context: vscode.ExtensionContext, mode: 'baseline' | 'live'): void {
    const instance = randomUUID();
    const workspaceIdentity = () => vscode.workspace.workspaceFolders?.map(folder => folder.uri.toString()).join('\n');
    const initialWorkspace = workspaceIdentity();
    let disposed = false;
    const isAllowed = () => !disposed && vscode.workspace.isTrusted && !vscode.env.remoteName
        && vscode.workspace.workspaceFolders?.length === 1
        && vscode.workspace.workspaceFolders[0].uri.scheme === 'file'
        && workspaceIdentity() === initialWorkspace;
    const assertAllowed = () => {
        if (!isAllowed()) {
            throw new Error('Prototype 1 requires its original, trusted, single local fixture workspace.');
        }
    };
    const output = vscode.window.createOutputChannel('CoR MCP prototype 1');
    const changed = new vscode.EventEmitter<void>();
    let providerCounters: DirectSocketPrototypeCounters | undefined;
    let sessions = 0;
    let commandCalls = 0;
    let viewCalls = 0;
    const snapshot = () => ({
        mode, instance, vscodeVersion: vscode.version, extensionVersion: ext.version,
        remote: vscode.env.remoteName ?? null, trusted: vscode.workspace.isTrusted,
        allowed: isAllowed(), provide: providerCounters?.provide ?? null, resolve: providerCounters?.resolve ?? null,
        listeners: providerCounters?.listeners ?? null, sessions, commandCalls, viewCalls,
        toolNames: ['prototype_instance', 'open_scaffold_next_steps_view'],
        label: mcpServerLabel,
        // MCP session IDs are not authenticated Chat/Agent Host identities.
        chatSessionIdentity: 'not-observed',
    });
    const record = (event: string) => output.appendLine(JSON.stringify({ event, ...snapshot() }));
    const guard = <T>(action: () => T) => {
        assertAllowed();
        return action();
    };
    context.subscriptions.push(output, changed, { dispose: () => { disposed = true; } });
    context.subscriptions.push(vscode.commands.registerCommand(prototypeIdentityCommand, () => guard(() => {
        commandCalls++;
        record('identity-command');
        return { instance, protocol: 1 };
    })));
    context.subscriptions.push(vscode.commands.registerCommand(diagnosticsCommand, () => {
        record('diagnostics');
        output.show();
        return snapshot();
    }));

    const options: McpProviderOptions = {
        id: mcpServerId,
        serverLabel: mcpServerLabel,
        serverVersion: ext.version,
        onDidChange: changed.event,
        registerTools: server => {
            assertAllowed();
            sessions++;
            record('mcp-session');
            registerDirectSocketPrototypeTools(server, {
                instance, assertAllowed, record,
                openNextSteps: async extras => {
                    const result = await openScaffoldNextStepsViewTool.execute(undefined, {
                        signal: extras.mcpReq.signal,
                        requestId: extras.mcpReq.id,
                        sessionId: extras.sessionId,
                    });
                    if (!isScaffoldNextStepsViewOpen()) {
                        throw new Error('The Next steps webview did not open.');
                    }
                    viewCalls++;
                    return result;
                },
            });
        },
    };

    if (mode === 'baseline') {
        // Keep the installed helper unchanged. It does not expose provide/resolve counters.
        if (isAllowed()) {
            registerMcpHttpProvider(context, options);
        } else {
            let registered = false;
            context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => {
                if (!registered && isAllowed()) {
                    registered = true;
                    registerMcpHttpProvider(context, options);
                }
            }));
        }
    } else {
        const provider = createDirectSocketPrototypeProvider(options, isAllowed, changed.event, record);
        providerCounters = provider.counters;
        context.subscriptions.push(provider, vscode.lm.registerMcpServerDefinitionProvider(mcpServerId, provider));
        context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => changed.fire()));
    }
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()));
    record('registered');
}
