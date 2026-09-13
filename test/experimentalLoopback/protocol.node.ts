/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { ServerContext } from '@modelcontextprotocol/server';
import * as assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { loopbackLimits, startLoopbackServer, type LoopbackListener } from '../../src/chat/tools/experimentalLoopback/loopbackServer';
import { createPrototypeToolRegistrar, markerToolName, nextStepsToolName, type PrototypeHandlers } from '../../src/chat/tools/experimentalLoopback/toolCatalog';

const initialize = {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'prototype-protocol-test', version: '1' } },
};

function deferred() {
    let resolve: () => void = () => { throw new Error('Promise not initialized'); };
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

async function fixture(t: TestContext, marker = 'opaque-window-a', overrides: Partial<PrototypeHandlers> = {}) {
    let effects = 0;
    const errors: string[] = [];
    const listener = await startLoopbackServer({
        id: 'azure-http-prototype-test',
        version: '1',
        registerTools: createPrototypeToolRegistrar({
            isTrusted: () => true,
            marker: async () => { effects++; return marker; },
            nextSteps: async () => { effects++; return { message: 'view fixture invoked' }; },
            ...overrides,
        }),
        onError: message => errors.push(message),
    });
    t.after(async () => { await listener.dispose(); assert.deepEqual(errors, []); });
    return { listener, effects: () => effects };
}

async function clientFor(t: TestContext, listener: LoopbackListener) {
    const transport = new StreamableHTTPClientTransport(listener.url, {
        requestInit: { headers: { ...listener.headers }, redirect: 'error' },
        reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 50, maxReconnectionDelay: 50, reconnectionDelayGrowFactor: 1 },
    });
    const client = new Client({ name: 'prototype-sdk-test', version: '1' });
    t.after(async () => client.close());
    await client.connect(transport);
    return { client, transport };
}

async function wire(listener: LoopbackListener, method = 'POST', body: unknown = initialize, headers: Record<string, string> = {}) {
    const response = await fetch(listener.url, {
        method,
        headers: { ...listener.headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
        body: method === 'POST' ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(2_000),
    });
    const text = await response.text();
    return { response, text };
}

void test('SDK initialize/list/call/result, exact catalog and strict no-argument schema', async t => {
    const f = await fixture(t);
    const { client, transport } = await clientFor(t, f.listener);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map(tool => tool.name).sort(), [markerToolName, nextStepsToolName].sort());
    assert.notEqual(transport.sessionId, f.listener.headers.Authorization);
    assert.equal(f.effects(), 0);
    const marker = await client.callTool({ name: markerToolName, arguments: {} });
    assert.deepEqual(marker.structuredContent, { marker: 'opaque-window-a' });
    const view = await client.callTool({ name: nextStepsToolName, arguments: {} });
    assert.deepEqual(view.structuredContent, { message: 'view fixture invoked' });
    assert.equal(f.effects(), 2);
    const invalid = await client.callTool({ name: markerToolName, arguments: { commandId: 'arbitrary', args: ['danger'] } });
    assert.equal(invalid.isError, true);
    await assert.rejects(client.callTool({ name: 'start_deployment', arguments: {} }), /not found/);
    assert.equal(f.effects(), 2);
});

void test('explicit SDK auto-negotiation probes discovery then performs genuine legacy initialize', async t => {
    const f = await fixture(t);
    const methods: string[] = [];
    const transport = new StreamableHTTPClientTransport(f.listener.url, {
        requestInit: { headers: { ...f.listener.headers }, redirect: 'error' },
        fetch: async (input, init) => {
            if (typeof init?.body === 'string') {
                const body: unknown = JSON.parse(init.body);
                if (body && typeof body === 'object' && 'method' in body && typeof body.method === 'string') {
                    methods.push(body.method);
                }
            }
            return fetch(input, init);
        },
    });
    const client = new Client({ name: 'auto-negotiation-probe', version: '1' }, {
        versionNegotiation: { mode: 'auto', probe: { timeoutMs: 1_000, maxRetries: 0 } },
    });
    t.after(async () => client.close());
    await client.connect(transport);
    assert.equal(methods[0], 'server/discover');
    assert.ok(methods.includes('initialize'));
    assert.equal(client.getProtocolEra(), 'legacy');
    assert.equal(client.getNegotiatedProtocolVersion(), '2025-11-25');
    assert.deepEqual((await client.callTool({ name: markerToolName })).structuredContent, { marker: 'opaque-window-a' });
    assert.equal(f.effects(), 1);
});

void test('missing/wrong/cross-listener/revoked credentials reject initialize and POST/GET/DELETE with zero effects', async t => {
    const a = await fixture(t);
    const b = await fixture(t, 'opaque-window-b');
    const { transport } = await clientFor(t, a.listener);
    for (const auth of ['', 'Nonce invalid', b.listener.headers.Authorization]) {
        for (const method of ['POST', 'GET', 'DELETE']) {
            const { response } = await wire(a.listener, method, {
                jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: markerToolName, arguments: {} },
            }, { Authorization: auth, 'mcp-session-id': transport.sessionId ?? '' });
            assert.equal(response.status, 401);
        }
        assert.equal((await wire(a.listener, 'POST', initialize, { Authorization: auth })).response.status, 401);
    }
    a.listener.revoke();
    for (const method of ['POST', 'GET', 'DELETE']) {
        assert.equal((await wire(a.listener, method, initialize, { 'mcp-session-id': transport.sessionId ?? '' })).response.status, 401);
    }
    assert.equal((await wire(a.listener)).response.status, 401);
    assert.equal(a.effects(), 0);
    assert.equal(b.effects(), 0);
});

void test('exact Host/Origin validation, no CORS, malformed and oversized bodies', async t => {
    const f = await fixture(t);
    const invalidHeaders: Record<string, string>[] = [
        { Origin: 'https://malicious.example' },
        { Origin: 'null' },
        { Origin: 'http://127.0.0.1:1' },
        { Host: 'malicious.example' },
        { Host: 'localhost' },
        { Host: '127.0.0.1:1' },
    ];
    for (const headers of invalidHeaders) {
        const response = await new Promise<{ status: number | undefined; cors: string | string[] | undefined }>((resolve, reject) => {
            const req = httpRequest(f.listener.url, {
                method: 'POST', headers: { ...f.listener.headers, ...headers },
            }, res => {
                res.resume();
                res.on('end', () => resolve({ status: res.statusCode, cors: res.headers['access-control-allow-origin'] }));
            });
            req.on('error', reject);
            req.end(JSON.stringify(initialize));
        });
        assert.equal(response.status, 403);
        assert.equal(response.cors, undefined);
    }
    const accepted = await wire(f.listener, 'POST', initialize, { Origin: f.listener.url.origin });
    assert.equal(accepted.response.status, 200);
    for (const [body, status] of [['{invalid', 400], ['x'.repeat(loopbackLimits.bodyBytes + 1), 413]] as const) {
        const response = await fetch(f.listener.url, {
            method: 'POST',
            headers: { ...f.listener.headers, 'Content-Type': 'application/json' },
            body,
        });
        assert.equal(response.status, status);
        await response.text();
    }
    const response = await fetch(f.listener.url, { method: 'OPTIONS', headers: { ...f.listener.headers } });
    assert.equal(response.status, 405);
    assert.equal(response.headers.has('access-control-allow-origin'), false);
    await response.text();
    assert.equal(f.effects(), 0);
});

void test('chunked body limit and absolute request-target authority', async t => {
    const f = await fixture(t);
    const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = httpRequest(f.listener.url, {
            method: 'POST', headers: { ...f.listener.headers, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
        }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', reject);
        req.write('x'.repeat(loopbackLimits.bodyBytes));
        req.end('x');
    });
    assert.equal(status, 413);
    const absolute = await new Promise<number | undefined>((resolve, reject) => {
        const req = httpRequest(f.listener.url, {
            path: 'http://malicious.example/mcp', method: 'POST', headers: { ...f.listener.headers },
        }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', reject);
        req.end(JSON.stringify(initialize));
    });
    assert.equal(absolute, 403);
    assert.equal(f.effects(), 0);
});

void test('two clients and two listeners remain independent; DELETE and restart reject stale sessions', async t => {
    const a = await fixture(t);
    const b = await fixture(t, 'opaque-window-b');
    const first = await clientFor(t, a.listener);
    const second = await clientFor(t, a.listener);
    const other = await clientFor(t, b.listener);
    assert.notEqual(first.transport.sessionId, second.transport.sessionId);
    assert.notEqual(a.listener.url.port, b.listener.url.port);
    assert.equal((await wire(b.listener, 'POST', initialize, { 'mcp-session-id': first.transport.sessionId ?? '' })).response.status, 404);
    const staleSession = first.transport.sessionId ?? '';
    await first.transport.terminateSession();
    assert.equal((await wire(a.listener, 'POST', initialize, { 'mcp-session-id': staleSession })).response.status, 404);
    assert.deepEqual((await second.client.callTool({ name: markerToolName })).structuredContent, { marker: 'opaque-window-a' });
    await a.listener.dispose();
    assert.deepEqual((await other.client.callTool({ name: markerToolName })).structuredContent, { marker: 'opaque-window-b' });
    const restarted = await fixture(t, 'opaque-window-restarted');
    assert.notEqual(a.listener.headers.Authorization, restarted.listener.headers.Authorization);
    assert.notEqual(a.listener.instanceId, restarted.listener.instanceId);
    assert.equal((await wire(restarted.listener, 'POST', initialize, { Authorization: a.listener.headers.Authorization })).response.status, 401);
    assert.equal((await wire(restarted.listener, 'POST', initialize, { 'mcp-session-id': staleSession })).response.status, 404);
    const fresh = await clientFor(t, restarted.listener);
    assert.deepEqual((await fresh.client.callTool({ name: markerToolName })).structuredContent, { marker: 'opaque-window-restarted' });
});

void test('trust enforced at execution and handler errors remain MCP errors', async t => {
    let trusted = true;
    const f = await fixture(t, 'opaque-window-a', {
        isTrusted: () => trusted,
        nextSteps: async () => { throw new Error('deliberate fixture failure'); },
    });
    const { client } = await clientFor(t, f.listener);
    assert.equal((await client.callTool({ name: nextStepsToolName })).isError, true);
    trusted = false;
    assert.equal((await client.callTool({ name: markerToolName })).isError, true);
    assert.equal(f.effects(), 0);
});

void test('SDK cancellation reaches handler; ambiguous dispatched work is never retried', async t => {
    const started = deferred();
    const cancelled = deferred();
    let effects = 0;
    const f = await fixture(t, 'opaque-window-a', {
        nextSteps: async (context: ServerContext) => {
            effects++;
            started.resolve();
            await new Promise<void>(resolve => context.mcpReq.signal.addEventListener('abort', () => {
                cancelled.resolve();
                resolve();
            }, { once: true }));
            return { message: 'already dispatched before cancellation' };
        },
    });
    const { client } = await clientFor(t, f.listener);
    const abort = new AbortController();
    const result = client.callTool({ name: nextStepsToolName }, { signal: abort.signal });
    const rejected = assert.rejects(result);
    await started.promise;
    abort.abort(new Error('test cancellation'));
    await rejected;
    await Promise.race([cancelled.promise, delay(2_000).then(() => { throw new Error('No server cancellation'); })]);
    await delay(100);
    assert.equal(effects, 1);
});

void test('session capacity and loopback-only address; disposal bounds open SSE and partial requests', async t => {
    const f = await fixture(t);
    for (let index = 0; index < loopbackLimits.sessions; index++) {
        assert.equal((await wire(f.listener)).response.status, 200);
    }
    assert.equal((await wire(f.listener)).response.status, 429);
    assert.equal(f.listener.url.hostname, '127.0.0.1');
    const external = Object.values(networkInterfaces()).flat().find(address => address?.family === 'IPv4' && !address.internal);
    if (external) {
        await assert.rejects(fetch(`http://${external.address}:${f.listener.url.port}/mcp`, { signal: AbortSignal.timeout(500) }));
    }
    const socket = connect(Number(f.listener.url.port), '127.0.0.1');
    socket.on('error', error => assert.equal('code' in error && error.code, 'ECONNRESET'));
    t.after(() => socket.destroy());
    await new Promise<void>(resolve => socket.once('connect', resolve));
    socket.write('POST /mcp HTTP/1.1\r\n');
    const start = Date.now();
    await f.listener.dispose();
    assert.ok(Date.now() - start < loopbackLimits.shutdownMs);
    await assert.rejects(fetch(f.listener.url, { signal: AbortSignal.timeout(500) }));
});

void test('concurrent request and TCP connection limits reject overflow without effects', async t => {
    const f = await fixture(t);
    const sockets = [];
    for (let index = 0; index < loopbackLimits.requests; index++) {
        const socket = connect(Number(f.listener.url.port), '127.0.0.1');
        socket.on('error', error => assert.equal('code' in error && error.code, 'ECONNRESET'));
        t.after(() => socket.destroy());
        await new Promise<void>(resolve => socket.once('connect', resolve));
        socket.write(`POST /mcp HTTP/1.1\r\nHost: ${f.listener.url.host}\r\nAuthorization: ${f.listener.headers.Authorization}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`);
        sockets.push(socket);
    }
    await delay(50);
    assert.equal((await wire(f.listener)).response.status, 429);
    sockets.forEach(socket => socket.destroy());
    await f.listener.dispose();

    const connections = await fixture(t);
    for (let index = 0; index < loopbackLimits.connections; index++) {
        const socket = connect(Number(connections.listener.url.port), '127.0.0.1');
        socket.on('error', error => assert.equal('code' in error && error.code, 'ECONNRESET'));
        t.after(() => socket.destroy());
        await new Promise<void>(resolve => socket.once('connect', resolve));
    }
    await delay(50);
    await assert.rejects(new Promise<void>((resolve, reject) => {
        const req = httpRequest(connections.listener.url, res => { res.resume(); res.on('end', resolve); });
        req.on('error', reject);
        req.end();
    }), { code: 'ECONNRESET' });
    assert.equal(f.effects(), 0);
    assert.equal(connections.effects(), 0);
});
