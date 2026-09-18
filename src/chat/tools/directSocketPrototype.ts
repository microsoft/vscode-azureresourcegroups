/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type McpProviderOptions, startInProcHttpServer } from '@microsoft/vscode-inproc-mcp/vscode';
import { request } from 'http';
import * as vscode from 'vscode';

export interface DirectSocketPrototypeCounters {
    provide: number;
    resolve: number;
    listeners: number;
}

export function getDirectSocketPrototypeMode(context: Pick<vscode.ExtensionContext, 'extensionMode'>): 'baseline' | 'live' | undefined {
    const mode = process.env.COR_MCP_DIRECT_SOCKET_PROTOTYPE;
    if ((context.extensionMode !== vscode.ExtensionMode.Development && context.extensionMode !== vscode.ExtensionMode.Test) || !mode) {
        return undefined;
    }
    if (mode !== 'baseline' && mode !== 'live') {
        throw new Error('COR_MCP_DIRECT_SOCKET_PROTOTYPE must be baseline or live.');
    }
    return mode;
}

export async function waitForPrivateListener(uri: vscode.Uri): Promise<void> {
    if (uri.scheme !== 'unix' && uri.scheme !== 'pipe') {
        throw new Error('The direct socket prototype must not use TCP.');
    }
    const deadline = Date.now() + 2000;
    while (true) {
        try {
            await new Promise<void>((resolve, reject) => {
                const probe = request({
                    socketPath: uri.fsPath,
                    path: uri.fragment,
                    method: 'GET',
                    headers: { Host: 'localhost' },
                    timeout: 500,
                }, response => {
                    response.resume();
                    if (response.statusCode === 401) {
                        resolve();
                    } else {
                        reject(new Error(`Private listener readiness returned ${response.statusCode}, expected 401.`));
                    }
                });
                probe.on('error', reject);
                probe.on('timeout', () => probe.destroy(new Error('Private listener readiness timed out.')));
                probe.end();
            });
            return;
        } catch (error) {
            const code = error instanceof Error && 'code' in error ? error.code : undefined;
            if ((code !== 'ENOENT' && code !== 'ECONNREFUSED') || Date.now() >= deadline) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
}

/** Throwaway experiment: publish a ready private endpoint without waiting for VS Code's resolver. */
export function createDirectSocketPrototypeProvider(
    options: McpProviderOptions,
    isAllowed: () => boolean,
    changed: vscode.Event<void>,
    record: (event: string) => void,
): vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition> & vscode.Disposable & { counters: DirectSocketPrototypeCounters } {
    let disposed = false;
    let listener: Awaited<ReturnType<typeof startInProcHttpServer>> | undefined;
    let starting: Promise<void> | undefined;
    const counters: DirectSocketPrototypeCounters = { provide: 0, resolve: 0, listeners: 0 };

    async function definition(): Promise<vscode.McpHttpServerDefinition> {
        if (disposed || !isAllowed()) {
            throw new Error('Direct socket prototype is not authorized in this extension instance.');
        }
        starting ??= (async () => {
            const started = await startInProcHttpServer(options);
            try {
                await waitForPrivateListener(started.serverUri);
                if (disposed || !isAllowed()) {
                    throw new Error('Direct socket prototype was revoked during startup.');
                }
                listener = started;
                counters.listeners++;
                record('listener-ready');
            } catch (error) {
                started.disposable.dispose();
                throw error;
            }
        })();
        await starting;
        if (disposed || !isAllowed() || !listener) {
            throw new Error('Direct socket prototype connection is no longer available.');
        }
        return new vscode.McpHttpServerDefinition(
            options.serverLabel, listener.serverUri, { ...listener.headers }, options.serverVersion,
        );
    }

    return {
        counters,
        onDidChangeMcpServerDefinitions: changed,
        async provideMcpServerDefinitions() {
            counters.provide++;
            record('provide');
            return disposed || !isAllowed() ? [] : [await definition()];
        },
        async resolveMcpServerDefinition() {
            counters.resolve++;
            record('resolve');
            return await definition();
        },
        dispose() {
            if (disposed) { return; }
            disposed = true;
            listener?.disposable.dispose();
            listener = undefined;
            record('disposed');
        },
    };
}
