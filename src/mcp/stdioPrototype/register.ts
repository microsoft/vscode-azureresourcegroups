/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpToolWithTelemetry, registerMcpToolWithTelemetry, startInProcHttpServer } from '@microsoft/vscode-inproc-mcp/vscode';
import { fromJsonSchema } from '@modelcontextprotocol/server';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as vscode from 'vscode';
import { openScaffoldNextStepsViewTool } from '../../chat/tools/copilotOnRails/openScaffoldNextStepsViewTool';
import { isScaffoldNextStepsViewOpen } from '../../webviews/copilotOnRails/extension/openScaffoldNextStepsView';
import { mcpServerId } from '../../constants';
import { createBridgeLaunchEnvironment, createSocketConnection, type ConnectionLease } from './connection';
import { assertPrototypeAccess, registerProbe } from './probe';

export async function registerStdioPrototype(context: vscode.ExtensionContext): Promise<void> {
    if (!vscode.workspace.isTrusted || vscode.env.remoteName || process.platform === 'win32') {
        throw new Error('The stdio prototype requires a trusted local Unix workspace.');
    }
    const output = vscode.window.createOutputChannel('Azure Resources MCP stdio prototype');
    context.subscriptions.push(output);
    const lease: ConnectionLease = {
        version: 1,
        instance: randomUUID(),
        serverId: 'vscode-azureresourcegroups.mcp',
        uri: '',
        authorization: '',
        expiresAt: Date.now() + 60 * 60 * 1000,
        workspace: vscode.workspace.workspaceFolders?.map(folder => folder.uri.toString()) ?? [],
    };
    let probeEffects = 0;
    let nextStepsCalls = 0;
    const probe = registerProbe(context, lease, line => {
        probeEffects++;
        output.appendLine(line);
    });
    let sessions = 0;
    let declarations = 0;
    // One listener per extension host avoids the package's module-global session-map disposal bug.
    const listener = await startInProcHttpServer({
        id: mcpServerId,
        serverLabel: 'Azure Resources stdio prototype',
        serverVersion: `prototype-2/${lease.instance}`,
        registerTools: server => {
            sessions++;
            output.appendLine(`Backend session created. instance=${lease.instance}; sessions=${sessions}`);
            server.server.oninitialized = () => { output.appendLine(`MCP initialized. instance=${lease.instance}`); };
            registerMcpToolWithTelemetry(server, probe);
            const nextSteps = new McpToolWithTelemetry(
                openScaffoldNextStepsViewTool.name,
                async (input, extras) => {
                    assertPrototypeAccess(lease);
                    extras?.signal.throwIfAborted();
                    const result = await openScaffoldNextStepsViewTool.execute(input, extras);
                    nextStepsCalls++;
                    output.appendLine(`Next steps called. instance=${lease.instance}; calls=${nextStepsCalls}; open=${isScaffoldNextStepsViewOpen()}`);
                    return result;
                },
                openScaffoldNextStepsViewTool,
            );
            // The package's void-input helper ignores arguments. Require an empty object here.
            server.registerTool(nextSteps.name, {
                description: nextSteps.description,
                annotations: nextSteps.annotations,
                inputSchema: fromJsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
            }, async (_input, extras) => nextSteps.executeMcp(undefined, {
                signal: extras.mcpReq.signal,
                requestId: extras.mcpReq.id,
                sessionId: extras.sessionId,
            }));
        },
    });
    lease.uri = listener.serverUri.toString();
    lease.authorization = listener.headers.Authorization;
    let revoked = false;
    const pairings: string[] = [];
    const changes = new vscode.EventEmitter<void>();
    const revoke = (): void => {
        if (revoked) {
            return;
        }
        revoked = true;
        lease.expiresAt = 0;
        listener.disposable.dispose();
        for (const directory of pairings) {
            try {
                unlinkSync(join(directory, 'mcp-config.json'));
                rmdirSync(directory);
            } catch {
                output.appendLine('Could not remove a prototype pairing file. Its listener is revoked.');
            }
        }
        changes.fire();
        output.appendLine('Prototype listener revoked. Reload the window to reconnect.');
    };
    const expiry = setTimeout(revoke, lease.expiresAt - Date.now());
    context.subscriptions.push(changes, { dispose: () => { clearTimeout(expiry); revoke(); } });
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(revoke));
    try {
        // The package returns before listen completes. Probe authenticated GET before publishing.
        let ready = false;
        for (let attempt = 0; attempt < 50 && !ready; attempt++) {
            try {
                const socket = await createSocketConnection(lease);
                try {
                    const response = await socket.fetch('http://localhost/mcp', { signal: AbortSignal.timeout(1000) });
                    ready = response.status === 400;
                    await response.body?.cancel();
                } finally {
                    await socket.close();
                }
            } catch (error) {
                if (attempt === 49) {
                    throw error;
                }
            }
            if (!ready) {
                await delay(20);
            }
        }
        if (!ready) {
            throw new Error('Prototype listener did not become ready.');
        }
        const definition = new vscode.McpStdioServerDefinition(
            'Azure Resources stdio prototype',
            process.execPath,
            [vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcpStdioBridge.js').fsPath],
            createBridgeLaunchEnvironment(lease),
            'prototype-2',
        );
        context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider(mcpServerId, {
            provideMcpServerDefinitions: () => {
                declarations++;
                output.appendLine(`MCP provide called. declarations=${declarations}; resolver=absent; transport=stdio; backend=unix; revoked=${revoked}`);
                return revoked ? [] : [definition];
            },
            onDidChangeMcpServerDefinitions: changes.event,
        }));
        context.subscriptions.push(vscode.commands.registerCommand('copilotOnRails.pairMcpStdioPrototype', () => {
            assertPrototypeAccess(lease, revoked);
            const directory = mkdtempSync(join(tmpdir(), 'azure-mcp-stdio-pair-'));
            chmodSync(directory, 0o700);
            pairings.push(directory);
            const configPath = join(directory, 'mcp-config.json');
            writeFileSync(configPath, JSON.stringify({
                mcpServers: {
                    'azure-resources-stdio-prototype': {
                        type: 'local', command: definition.command, args: definition.args, env: definition.env, tools: ['*'],
                    },
                },
            }), { mode: 0o600, flag: 'wx' });
            output.appendLine(`Explicit pairing created: ${configPath}. Contains a private lease; do not share it.`);
            output.show(true);
            return { configPath, instance: lease.instance };
        }));
        context.subscriptions.push(vscode.commands.registerCommand('copilotOnRails.mcpStdioPrototypeStatus', () => ({
            instance: lease.instance, declarations, sessions, probeEffects, nextStepsCalls,
            nextStepsOpen: isScaffoldNextStepsViewOpen(), revoked,
        })));
        await vscode.commands.executeCommand('setContext', 'azureResources.mcpStdioPrototype', true);
        output.appendLine(`Prototype ready. instance=${lease.instance}; lease expires in 60 minutes; tools=cor_stdio_probe,open_scaffold_next_steps_view`);
    } catch {
        revoke();
        throw new Error('Could not provision the private MCP stdio prototype listener.');
    }
}
