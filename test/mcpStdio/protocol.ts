/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerMcpHttpProvider, registerMcpToolWithTelemetry, startInProcHttpServer } from '@microsoft/vscode-inproc-mcp/vscode';
import { Client } from '@modelcontextprotocol/client';
import { type McpServer } from '@modelcontextprotocol/server';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { strict as assert } from 'node:assert';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { after, test } from 'node:test';
import { promisify } from 'node:util';
import type * as vscode from 'vscode';
import { z } from 'zod';
import { createBridgeLaunchEnvironment, createSocketConnection, maxFrameBytes, type ConnectionLease } from '../../src/mcp/stdioPrototype/connection';
import { registerProbe } from '../../src/mcp/stdioPrototype/probe';
import { providers, telemetryEvents, workspace } from './hostFixture';

const entry = resolve('dist/mcpStdioBridge.js');
const runtime = process.env.MCP_STDIO_TEST_EXECUTABLE ?? process.execPath;
const context = { subscriptions: [] as vscode.Disposable[] };
const effects: string[] = [];
const lease: ConnectionLease = {
    version: 1, instance: randomUUID(), serverId: 'vscode-azureresourcegroups.mcp',
    uri: '', authorization: '', expiresAt: Date.now() + 60_000,
    workspace: workspace.workspaceFolders.map(folder => folder.uri.toString()),
};
let listener: Awaited<ReturnType<typeof startInProcHttpServer>>;
let socket: Awaited<ReturnType<typeof createSocketConnection>>;
const servers: McpServer[] = [];
const sessions = new Set<string>();
const sessionsByMarker = new Map<string, string>();
const stderr: string[] = [];
let dropAfterEffect = false;
let droppedEffects = 0;
let paginated = false;

after(async () => {
    await socket?.close();
    listener?.disposable.dispose();
    context.subscriptions.forEach(item => item.dispose());
    assert(stderr.every(line => !line.includes(lease.authorization) && !line.includes(lease.uri)), 'No credential or socket URI in bridge logs');
});

async function connect(connection = lease, negotiation: 'legacy' | 'auto' = 'legacy') {
    const transport = new StdioClientTransport({
        command: runtime,
        args: [entry],
        env: createBridgeLaunchEnvironment(connection),
        stderr: 'pipe',
    });
    transport.stderr?.on('data', chunk => { stderr.push(String(chunk)); });
    const client = new Client({ name: 'prototype-public-client', version: '1' }, { versionNegotiation: { mode: negotiation } });
    try {
        await client.connect(transport);
    } catch (error) {
        await transport.close();
        throw error;
    }
    return { client, transport };
}

void test('baseline provider publishes the unresolved placeholder, with no listener or tools', () => {
    let registered = false;
    registerMcpHttpProvider(context as vscode.ExtensionContext, {
        id: lease.serverId, serverLabel: 'baseline', serverVersion: '1',
        registerTools: () => { registered = true; },
    });
    assert.equal(providers[0].provideMcpServerDefinitions()[0].uri.toString(), 'http://invalid.invalid/');
    assert.equal(registered, false);
});

void test('actual package HTTP listener initializes through public stdio, not a mock protocol', async () => {
    const probe = registerProbe(context, lease, line => effects.push(line));
    listener = await startInProcHttpServer({
        id: lease.serverId, serverLabel: 'prototype protocol backend', serverVersion: `prototype-2/${lease.instance}`,
        registerTools: server => {
            servers.push(server);
            registerMcpToolWithTelemetry(server, probe);
            server.registerTool('protocol_result', { inputSchema: { text: z.string() } }, (input, extra) => {
                if (extra.sessionId) {
                    sessions.add(extra.sessionId);
                    sessionsByMarker.set(input.text, extra.sessionId);
                }
                return {
                    content: [{ type: 'text', text: input.text }, { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
                    structuredContent: { text: input.text },
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    _meta: { marker: 'preserved' },
                };
            });
            if (dropAfterEffect) {
                server.registerTool('protocol_drop_after_effect', {}, async () => {
                    droppedEffects++;
                    await server.close();
                    return { content: [{ type: 'text', text: 'Effect happened before connection loss.' }] };
                });
            }
            if (paginated) {
                server.server.setRequestHandler('tools/list', request => ({
                    tools: [{ name: request.params?.cursor ? 'page_two' : 'page_one', inputSchema: { type: 'object' } }],
                    nextCursor: request.params?.cursor ? undefined : 'opaque-page-cursor',
                }));
            }
        },
    });
    lease.uri = listener.serverUri.toString();
    lease.authorization = listener.headers.Authorization;
    await delay(30);
    socket = await createSocketConnection(lease);
    const { client, transport } = await connect();
    try {
        assert.equal(client.getServerVersion()?.name, lease.serverId);
        assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['cor_stdio_probe', 'protocol_result']);
        const result = await client.callTool({ name: 'cor_stdio_probe', arguments: { instance: lease.instance } });
        assert.deepEqual(result.structuredContent, { instance: lease.instance, count: 1 });
        assert.equal(effects.length, 1);
        assert(telemetryEvents.includes('mcpTool/cor_stdio_probe'));
        assert.equal((await lstat(listener.serverUri.path)).isSocket(), true);
    } finally {
        await transport.close();
    }
});

void test('tool-list notifications and opaque pagination cursors cross the bridge unchanged', async () => {
    const a = await connect();
    try {
        let received = false;
        a.client.setNotificationHandler('notifications/tools/list_changed', () => { received = true; });
        await a.client.listTools();
        await delay(50);
        servers[servers.length - 1].sendToolListChanged();
        for (let attempt = 0; attempt < 50 && !received; attempt++) {
            await delay(10);
        }
        assert.equal(received, true);
    } finally {
        await a.transport.close();
    }
    paginated = true;
    const b = await connect();
    paginated = false;
    try {
        const first = await b.client.request({ method: 'tools/list' });
        assert.equal(first.tools[0].name, 'page_one');
        assert.equal(first.nextCursor, 'opaque-page-cursor');
        const second = await b.client.request({ method: 'tools/list', params: { cursor: first.nextCursor } });
        assert.equal(second.tools[0].name, 'page_two');
        assert.equal(second.nextCursor, undefined);
    } finally {
        await b.transport.close();
    }
});

void test('modern discovery probes fall back to the backend legacy initialization', async () => {
    const { client, transport } = await connect(lease, 'auto');
    try {
        assert.equal((await client.listTools()).tools.length, 2);
    } finally {
        await transport.close();
    }
});

void test('raw stdio contains only JSON-RPC and preserves streamed large results', async () => {
    const child = spawn(runtime, [entry], { env: { ...process.env, ...createBridgeLaunchEnvironment(lease) }, stdio: 'pipe' });
    const exited = once(child, 'exit');
    child.stderr.on('data', chunk => { stderr.push(String(chunk)); });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const schema = z.object({ jsonrpc: z.literal('2.0'), id: z.number(), result: z.record(z.string(), z.unknown()) });
    const read = async () => {
        const line = await lines.next();
        assert.equal(line.done, false);
        return schema.parse(JSON.parse(line.value));
    };
    const send = (value: object) => { child.stdin.write(`${JSON.stringify(value)}\n`); };
    try {
        send({ jsonrpc: '2.0', id: 88, method: 'initialize', params: {
            protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw-stdio-test', version: '1' },
        } });
        assert.equal((await read()).id, 88);
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: 89, method: 'tools/list' });
        assert.equal((await read()).id, 89);
        const text = 'streamed text '.repeat(20_000);
        send({ jsonrpc: '2.0', id: 90, method: 'tools/call', params: { name: 'protocol_result', arguments: { text } } });
        const response = await read();
        assert.equal(response.id, 90);
        assert.deepEqual(response.result.structuredContent, { text });
        child.stdin.end();
        assert.equal((await exited)[0], 0);
        assert.equal((await lines.next()).done, true);
    } finally {
        child.kill('SIGTERM');
        await exited;
    }
});

void test('preserves rich results, isError, strict input validation and wrong instance rejection', async () => {
    const { client, transport } = await connect();
    try {
        const result = await client.callTool({ name: 'protocol_result', arguments: { text: 'original' } });
        assert.deepEqual(result.content, [{ type: 'text', text: 'original' }, { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }]);
        assert.deepEqual(result.structuredContent, { text: 'original' });
        assert.deepEqual(result._meta, { marker: 'preserved' });
        const before = effects.length;
        for (const args of [{ instance: randomUUID() }, { instance: lease.instance, commandId: 'workbench.action.quit' }, { instance: lease.instance, action: 'fail' }]) {
            assert.equal((await client.callTool({ name: 'cor_stdio_probe', arguments: args })).isError, true);
        }
        await assert.rejects(client.callTool({ name: 'executeCommand', arguments: {} }), /not found/);
        assert.equal(effects.length, before);
    } finally {
        await transport.close();
    }
});

void test('extension-side workspace trust and original-workspace checks deny execution', async () => {
    const { client, transport } = await connect();
    const before = effects.length;
    const originalFolders = workspace.workspaceFolders;
    try {
        workspace.isTrusted = false;
        assert.equal((await client.callTool({ name: 'cor_stdio_probe', arguments: { instance: lease.instance } })).isError, true);
        workspace.isTrusted = true;
        workspace.workspaceFolders = [];
        assert.equal((await client.callTool({ name: 'cor_stdio_probe', arguments: { instance: lease.instance } })).isError, true);
        assert.equal(effects.length, before);
    } finally {
        workspace.isTrusted = true;
        workspace.workspaceFolders = originalFolders;
        await transport.close();
    }
});

void test('cancellation reaches the fixed command before its effect', async () => {
    const { client, transport } = await connect();
    const before = effects.length;
    try {
        const abort = new AbortController();
        const call = client.callTool({ name: 'cor_stdio_probe', arguments: { instance: lease.instance, delayMs: 1000 } }, { signal: abort.signal });
        const cancelled = assert.rejects(call);
        await delay(100);
        abort.abort();
        await cancelled;
        await delay(1100);
        assert.equal(effects.length, before);
        assert.equal((await client.listTools()).tools.length, 2);
    } finally {
        await transport.close();
    }
});

void test('two independent clients have distinct backend sessions and survive sibling disconnect', async () => {
    const a = await connect();
    const b = await connect();
    try {
        sessions.clear();
        await Promise.all([a.client.callTool({ name: 'protocol_result', arguments: { text: 'A' } }), b.client.callTool({ name: 'protocol_result', arguments: { text: 'B' } })]);
        assert.equal(sessions.size, 2);
        const aSession = sessionsByMarker.get('A');
        assert(aSession);
        await a.transport.close();
        const response = await socket.fetch('http://localhost/mcp', { headers: { 'mcp-session-id': aSession } });
        assert.equal(response.status, 400, 'EOF must DELETE the first backend session');
        await response.body?.cancel();
        assert.equal((await b.client.listTools()).tools.length, 2);
    } finally {
        await Promise.all([a.transport.close(), b.transport.close()]);
    }
});

void test('20 reconnect cycles and 20 concurrent mixed calls retain exact effect counts', async () => {
    const start = performance.now();
    const before = effects.length;
    for (let cycle = 0; cycle < 20; cycle++) {
        const { client, transport } = await connect();
        try {
            if (cycle === 0 && transport.pid) {
                const { stdout } = await promisify(execFile)('ps', ['-o', 'rss=', '-p', String(transport.pid)]);
                console.log(`Bridge idle RSS: ${Number(stdout.trim())} KiB`);
            }
            await Promise.all(Array.from({ length: 20 }, (_, index) => index % 2
                ? client.listTools()
                : client.callTool({ name: 'cor_stdio_probe', arguments: { instance: lease.instance } })));
        } finally {
            await transport.close();
        }
    }
    assert.equal(effects.length - before, 200);
    console.log(`20 reconnects, 400 mixed calls, 200 effects: ${Math.round(performance.now() - start)}ms`);
});

void test('bridge lease expiry disconnects an idle initialized client', async () => {
    const { client, transport } = await connect({ ...lease, expiresAt: Date.now() + 500 });
    try {
        const closed = new Promise<void>(resolve => { client.onclose = () => resolve(); });
        await closed;
        await assert.rejects(client.listTools());
    } finally {
        await transport.close();
    }
});

void test('unauthorized HTTP methods and copied session IDs never execute a tool', async () => {
    const unauthorized = await createSocketConnection({ ...lease, authorization: `Nonce ${randomUUID()}` });
    const before = effects.length;
    try {
        for (const method of ['GET', 'POST', 'DELETE']) {
            const response = await unauthorized.fetch('http://localhost/mcp', {
                method, headers: { 'mcp-session-id': [...sessions][0] ?? 'unknown' },
                body: method === 'POST' ? JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'cor_stdio_probe', arguments: { instance: lease.instance } } }) : undefined,
            });
            assert.equal(response.status, 401);
            await response.body?.cancel();
        }
        await assert.rejects(connect({ ...lease, authorization: `Nonce ${randomUUID()}` }));
        assert.equal(effects.length, before);
    } finally {
        await unauthorized.close();
    }
});

void test('expired and malformed leases fail without logging secrets', async () => {
    await assert.rejects(connect({ ...lease, expiresAt: Date.now() - 1 }));
    await assert.rejects(connect({ ...lease, uri: 'http://localhost:7777/mcp' }));
    await assert.rejects(connect({ ...lease, instance: randomUUID() }));
});

void test('an effect followed by stream loss is not automatically retried', async () => {
    dropAfterEffect = true;
    const { client, transport } = await connect();
    dropAfterEffect = false;
    try {
        await assert.rejects(client.callTool({ name: 'protocol_drop_after_effect', arguments: {} }));
        await delay(150);
        assert.equal(droppedEffects, 1);
    } finally {
        await transport.close();
    }
});

void test('malformed and oversized stdio frames exit promptly with clean protocol stdout', async () => {
    for (const frame of ['{not-json}\n', '[]\n', '{"jsonrpc":"2.0"}', 'x'.repeat(maxFrameBytes + 1)]) {
        const child = spawn(runtime, [entry], { env: { ...process.env, ...createBridgeLaunchEnvironment(lease) }, stdio: 'pipe' });
        let stdout = '';
        let errors = '';
        child.stdout.on('data', chunk => { stdout += String(chunk); });
        child.stderr.on('data', chunk => { errors += String(chunk); });
        child.stdin.on('error', () => { /* The bridge closes input when rejecting a frame. */ });
        const exited = once(child, 'exit');
        child.stdin.end(frame);
        const [code] = await exited;
        assert.equal(code, 1, `frame bytes=${frame.length}; stderr=${errors}`);
        assert.equal(stdout, '');
        assert(!errors.includes(lease.authorization));
        stderr.push(errors);
    }
});

void test('backend disposal terminates existing clients, stale reconnect fails, no mutation retry', async () => {
    const { client, transport } = await connect();
    const before = effects.length;
    const pending = client.callTool({ name: 'cor_stdio_probe', arguments: { instance: lease.instance, delayMs: 1000 } });
    const rejected = assert.rejects(pending);
    await delay(100);
    listener.disposable.dispose();
    await rejected;
    await transport.close();
    await delay(1100);
    assert(effects.length - before <= 1, 'A dispatched effect is never replayed after backend loss');
    await assert.rejects(connect());
});
