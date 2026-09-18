/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerMcpHttpProvider, type McpProviderOptions } from '@microsoft/vscode-inproc-mcp/vscode';
import assert from 'assert/strict';
import { randomUUID } from 'crypto';
import { existsSync, statSync } from 'fs';
import { request } from 'http';
import { dirname } from 'path';
import * as vscode from 'vscode';
import { createDirectSocketPrototypeProvider, getDirectSocketPrototypeMode, waitForPrivateListener } from '../../src/chat/tools/directSocketPrototype';
import { prototypeIdentityCommand, registerDirectSocketPrototypeTools } from '../../src/chat/tools/directSocketPrototypeTools';
import { providers } from './vscodeMock.cjs';

type WireReply = {
    result?: { tools?: { name: string }[]; content?: { type: string; text: string }[]; isError?: boolean };
    error?: { message: string };
};

async function exchange(
    definition: vscode.McpHttpServerDefinition,
    method: 'GET' | 'POST' | 'DELETE',
    body?: object,
    headers: Record<string, string> = definition.headers,
    session?: string,
): Promise<{ status: number; session?: string; messages: WireReply[] }> {
    return await new Promise((resolve, reject) => {
        const req = request({
            socketPath: definition.uri.fsPath,
            path: definition.uri.fragment,
            method,
            headers: {
                Host: 'localhost',
                Accept: 'application/json, text/event-stream',
                'Content-Type': 'application/json',
                ...headers,
                ...(session ? { 'Mcp-Session-Id': session } : {}),
            },
            timeout: 3000,
        }, response => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { text += chunk; });
            response.on('end', () => {
                const data = text.startsWith('{') ? [text] : text.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5));
                resolve({
                    status: response.statusCode ?? 0,
                    session: typeof response.headers['mcp-session-id'] === 'string' ? response.headers['mcp-session-id'] : undefined,
                    messages: data.map(line => JSON.parse(line) as WireReply),
                });
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Private protocol request timed out.')));
        req.end(body ? JSON.stringify(body) : undefined);
    });
}

export async function run(): Promise<void> {
    const passed: string[] = [];
    const originalMode = process.env.COR_MCP_DIRECT_SOCKET_PROTOTYPE;
    try {
        delete process.env.COR_MCP_DIRECT_SOCKET_PROTOTYPE;
        assert.equal(getDirectSocketPrototypeMode({ extensionMode: vscode.ExtensionMode.Development }), undefined);
        process.env.COR_MCP_DIRECT_SOCKET_PROTOTYPE = 'live';
        assert.equal(getDirectSocketPrototypeMode({ extensionMode: vscode.ExtensionMode.Production }), undefined);
        assert.equal(getDirectSocketPrototypeMode({ extensionMode: vscode.ExtensionMode.Development }), 'live');
        process.env.COR_MCP_DIRECT_SOCKET_PROTOTYPE = 'baseline';
        assert.equal(getDirectSocketPrototypeMode({ extensionMode: vscode.ExtensionMode.Test }), 'baseline');
        process.env.COR_MCP_DIRECT_SOCKET_PROTOTYPE = 'invalid';
        assert.throws(() => getDirectSocketPrototypeMode({ extensionMode: vscode.ExtensionMode.Development }));
        passed.push('production ignores prototype opt-in; development/test requires an explicit valid mode');
    } finally {
        if (originalMode === undefined) { delete process.env.COR_MCP_DIRECT_SOCKET_PROTOTYPE; }
        else { process.env.COR_MCP_DIRECT_SOCKET_PROTOTYPE = originalMode; }
    }
    const marker = randomUUID();
    let commands = 0;
    let views = 0;
    let allowed = true;
    let returnedMarker = marker;
    const events: string[] = [];
    const changed = new vscode.EventEmitter<void>();
    const command = vscode.commands.registerCommand(prototypeIdentityCommand, () => {
        commands++;
        return { instance: returnedMarker, protocol: 1 };
    });
    const options: McpProviderOptions = {
        id: 'prototype.protocol.control',
        serverLabel: 'Copilot Azure Resources Extension Tools',
        serverVersion: 'prototype',
        registerTools: server => registerDirectSocketPrototypeTools(server, {
            instance: marker,
            assertAllowed: () => {
                if (!allowed) { throw new Error('Denied'); }
            },
            openNextSteps: async () => {
                views++;
                return { message: 'Simulated view handler only' };
            },
            record: event => events.push(event),
        }),
    };
    const token = new vscode.CancellationTokenSource();
    const provider = createDirectSocketPrototypeProvider(options, () => allowed, changed.event, event => events.push(event));
    const definitions = async () => await provider.provideMcpServerDefinitions(token.token);
    let live: vscode.McpHttpServerDefinition | undefined;
    let session: string | undefined;
    let id = 0;
    const rpc = async (definition: vscode.McpHttpServerDefinition, method: string, params: object = {}) =>
        exchange(definition, 'POST', { jsonrpc: '2.0', id: ++id, method, params }, definition.headers, session);
    try {
        allowed = false;
        assert.deepEqual(await definitions(), []);
        assert.equal(provider.counters.listeners, 0);
        passed.push('untrusted provider publishes nothing and starts no listener');
        allowed = true;
        const [first, second] = await Promise.all([definitions(), definitions()]);
        assert(first?.[0] && second?.[0]);
        live = first[0];
        assert.equal(live.uri.scheme, process.platform === 'win32' ? 'pipe' : 'unix');
        assert.equal(live.uri.toString(), second[0].uri.toString());
        assert.deepEqual(provider.counters, { provide: 3, resolve: 0, listeners: 1 });
        assert(live.headers.Authorization.startsWith('Nonce '));
        if (process.platform !== 'win32') {
            assert.equal(statSync(dirname(live.uri.fsPath)).mode & 0o777, 0o700);
        }
        passed.push('concurrent publication returns one ready private listener before resolve');

        const unauthorizedHeaders: Record<string, string>[] = [{}, { Authorization: 'Nonce wrong' }];
        for (const method of ['GET', 'POST', 'DELETE'] as const) {
            for (const headers of unauthorizedHeaders) {
                assert.equal((await exchange(live, method, undefined, headers)).status, 401);
            }
        }
        assert.equal(commands + views, 0);
        passed.push('missing and incorrect nonce rejected on GET POST DELETE, zero effects');

        const initialized = await rpc(live, 'initialize', {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'prototype-node-protocol-test', version: '1' },
        });
        assert.equal(initialized.status, 200);
        session = initialized.session;
        assert(session);
        await exchange(live, 'POST', { jsonrpc: '2.0', method: 'notifications/initialized' }, live.headers, session);
        const listed = await rpc(live, 'tools/list');
        assert.deepEqual(listed.messages[0].result?.tools?.map(tool => tool.name).sort(), ['open_scaffold_next_steps_view', 'prototype_instance']);
        const identity = await rpc(live, 'tools/call', { name: 'prototype_instance', arguments: {} });
        assert.deepEqual(JSON.parse(identity.messages[0].result?.content?.[0].text ?? ''), { instance: marker, protocol: 1 });
        assert.equal(commands, 1);
        passed.push('actual MCP initializes, lists exactly two safe test handlers and binds marker');

        for (const params of [
            { name: 'execute_command', arguments: { commandId: 'anything' } },
            { name: 'prototype_instance', arguments: { commandId: 'anything' } },
            { name: 'open_scaffold_next_steps_view', arguments: { workspace: '/wrong' } },
        ]) {
            const rejected = await rpc(live, 'tools/call', params);
            assert(rejected.messages[0].error || rejected.messages[0].result?.isError);
        }
        assert.equal(commands, 1);
        assert.equal(views, 0);
        allowed = false;
        const denied = await rpc(live, 'tools/call', { name: 'prototype_instance', arguments: {} });
        assert(denied.messages[0].result?.isError);
        assert.equal(commands, 1);
        allowed = true;
        passed.push('unknown tools, extra input and execution-time denial have zero effects');

        returnedMarker = randomUUID();
        const wrongInstance = await rpc(live, 'tools/call', { name: 'prototype_instance', arguments: {} });
        assert(wrongInstance.messages[0].result?.isError);
        returnedMarker = marker;
        await rpc(live, 'tools/call', { name: 'open_scaffold_next_steps_view', arguments: {} });
        assert.equal(views, 1);
        passed.push('actual named adapter rejects wrong command instance and invokes only the selected view callback');

        const resolved = await provider.resolveMcpServerDefinition?.(live, token.token);
        assert.equal(resolved?.uri.toString(), live.uri.toString());
        assert.deepEqual(resolved?.headers, live.headers);
        assert.equal(provider.counters.listeners, 1);
        passed.push('Local-style resolver returns the same endpoint and nonce without a second listener');

        provider.dispose();
        await assert.rejects(exchange(live, 'POST'));
        assert.deepEqual(await definitions(), []);
        assert(!existsSync(live.uri.fsPath));
        passed.push('disposal rejects stale connection and removes private socket');

        const reloaded = createDirectSocketPrototypeProvider(options, () => true, changed.event, () => undefined);
        try {
            const next = await reloaded.provideMcpServerDefinitions(token.token);
            assert(next?.[0]);
            assert.notEqual(next[0].uri.toString(), live.uri.toString());
            assert.notDeepEqual(next[0].headers, live.headers);
            assert.equal((await exchange(next[0], 'POST', undefined, live.headers)).status, 401);
            assert.equal((await exchange(next[0], 'POST', {
                jsonrpc: '2.0', id: ++id, method: 'tools/list',
            }, next[0].headers, session)).status, 400);
            passed.push('new provider lifetime rotates endpoint and nonce; old credential rejected');
        } finally { reloaded.dispose(); }

        const context = { subscriptions: [] as vscode.Disposable[] } as vscode.ExtensionContext;
        registerMcpHttpProvider(context, options);
        try {
            const baseline = providers.get(options.id);
            assert(baseline);
            let provide = 0;
            let resolve = 0;
            const declared = await baseline.provideMcpServerDefinitions(token.token);
            provide++;
            assert(declared?.[0] instanceof vscode.McpHttpServerDefinition);
            const placeholder = declared[0];
            assert.equal(placeholder.uri.toString(), 'http://invalid.invalid/');
            assert.deepEqual(placeholder.headers, {});
            const ready = await baseline.resolveMcpServerDefinition?.(placeholder, token.token);
            resolve++;
            assert(ready instanceof vscode.McpHttpServerDefinition);
            await waitForPrivateListener(ready.uri);
            assert.equal((await exchange(ready, 'GET', undefined, {})).status, 401);
            session = undefined;
            const initializedBaseline = await rpc(ready, 'initialize', {
                protocolVersion: '2025-11-25', capabilities: {},
                clientInfo: { name: 'prototype-baseline-control', version: '1' },
            });
            assert.equal(initializedBaseline.status, 200);
            session = initializedBaseline.session;
            await exchange(ready, 'POST', { jsonrpc: '2.0', method: 'notifications/initialized' }, ready.headers, session);
            const baselineTools = await rpc(ready, 'tools/list');
            assert.equal(baselineTools.messages[0].result?.tools?.length, 2);
            const afterResolve = await baseline.provideMcpServerDefinitions(token.token);
            provide++;
            assert(afterResolve?.[0] instanceof vscode.McpHttpServerDefinition);
            assert.equal(afterResolve[0].uri.toString(), 'http://invalid.invalid/');
            assert.deepEqual({ provide, resolve }, { provide: 2, resolve: 1 });
            passed.push('unchanged installed high-level helper publishes placeholder before AND after resolve: provide=2 resolve=1');
        } finally { context.subscriptions.forEach(item => item.dispose()); }

        const revoked = createDirectSocketPrototypeProvider(options, () => true, changed.event, () => undefined);
        const pending = revoked.provideMcpServerDefinitions(token.token);
        revoked.dispose();
        await assert.rejects(Promise.resolve(pending));
        passed.push('disposal during startup rejects publication and cleans up');

        assert(events.includes('listener-ready'));
        assert(!JSON.stringify(events).includes(live.headers.Authorization));
        console.log(JSON.stringify({
            evidence: 'Node protocol tests with mocked VS Code API, not real Chat or webview execution',
            passed, total: passed.length, toolCount: 2, commandHandlerCalls: commands, simulatedViewCalls: views,
            liveCounters: provider.counters,
        }, null, 2));
    } finally {
        provider.dispose();
        changed.dispose();
        token.dispose();
        command.dispose();
    }
}
