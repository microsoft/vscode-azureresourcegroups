/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { build } from 'esbuild';
import * as assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import type * as vscode from 'vscode';
import { createPrototypeToolRegistrar, markerCommandId, markerToolName } from '../../src/chat/tools/experimentalLoopback/toolCatalog';
import { readFile } from 'node:fs/promises';

class Emitter {
    private readonly callbacks = new Set<() => void>();
    public event = (callback: () => void) => {
        this.callbacks.add(callback);
        return { dispose: () => this.callbacks.delete(callback) };
    };
    public fire(): void { this.callbacks.forEach(callback => callback()); }
    public dispose(): void { this.callbacks.clear(); }
}

async function host(environment = '1', mode = 2) {
    const bundled = await build({
        entryPoints: ['src/chat/tools/experimentalLoopback/registerLoopbackPrototype.ts'],
        bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
    });
    const commands = new Map<string, (...args: unknown[]) => unknown>();
    const logs: string[] = [];
    const providers: vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition>[] = [];
    const foldersChanged = new Emitter();
    const workspace = {
        isTrusted: true,
        workspaceFolders: [{ uri: { scheme: 'file' } }],
        onDidChangeWorkspaceFolders: foldersChanged.event,
    };
    const env: { remoteName: string | undefined } = { remoteName: undefined };
    let confirm: () => Promise<string | undefined> = async () => 'Enable for this window';
    const subscriptions: { dispose(): unknown }[] = [];
    const fakeVscode = {
        l10n: { t: (message: string) => message },
        ExtensionMode: { Production: 1, Development: 2, Test: 3 },
        workspace, env, EventEmitter: Emitter,
        Uri: { parse: (uri: string) => new URL(uri) },
        McpHttpServerDefinition: class {
            public constructor(public label: string, public uri: URL, public headers: Record<string, string>, public version: string) { }
        },
        window: {
            createOutputChannel: () => ({
                info: (message: string) => logs.push(message),
                error: (message: string) => logs.push(message),
                dispose: () => undefined,
            }),
            showWarningMessage: async () => confirm(),
            showInformationMessage: async () => undefined,
        },
        commands: {
            registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
                commands.set(id, handler);
                return { dispose: () => commands.delete(id) };
            },
            executeCommand: async (id: string) => commands.get(id)?.(),
        },
        lm: {
            registerMcpServerDefinitionProvider: (_id: string, provider: vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition>) => {
                providers.push(provider);
                return { dispose: () => providers.splice(providers.indexOf(provider), 1) };
            },
        },
    };
    const module = { exports: {} };
    const require = createRequire(__filename);
    runInNewContext(bundled.outputFiles[0].text, {
        module, exports: module.exports,
        require: (id: string) => id === 'vscode' ? fakeVscode : require(id),
        process: { env: { ['AZURE_RESOURCES_MCP_HTTP_PROTOTYPE']: environment } },
        Buffer, URL, Response, Request, ReadableStream, setTimeout, clearTimeout, setInterval, clearInterval,
    });
    const registration = module.exports as typeof import('../../src/chat/tools/experimentalLoopback/registerLoopbackPrototype');
    const context = { extensionMode: mode, subscriptions } as vscode.ExtensionContext;
    const enabled = await registration.registerLoopbackPrototype(context, createPrototypeToolRegistrar({
        isTrusted: () => workspace.isTrusted,
        marker: async () => {
            const result = await commands.get(markerCommandId)?.();
            assert.ok(typeof result === 'string');
            return result;
        },
        nextSteps: async () => ({ message: 'fixture view' }),
    }), 'test');
    return {
        enabled, commands, logs, providers, workspace, env, foldersChanged,
        confirm: (callback: typeof confirm) => { confirm = callback; },
        stop: async () => {
            await registration.stopLoopbackPrototype();
            subscriptions.reverse().forEach(subscription => subscription.dispose());
        },
        enable: async () => commands.get('azureResourceGroups.experimentalMcpHttp.enable')?.(),
        disable: async () => commands.get('azureResourceGroups.experimentalMcpHttp.stop')?.(),
        definitions: async () => {
            const definitions = await providers[0].provideMcpServerDefinitions({
                isCancellationRequested: false,
                onCancellationRequested: () => ({ dispose: () => undefined }),
            });
            return definitions ?? [];
        },
    };
}

void test('provider is absent without development opt-in; private registration remains the caller default', async () => {
    for (const [environment, mode] of [['', 2], ['1', 1]] as const) {
        const h = await host(environment, mode);
        assert.equal(h.enabled, false);
        assert.equal(h.providers.length, 0);
        assert.equal(h.commands.size, 0);
        await h.stop();
    }
});

void test('ready initial definition works without resolve; stop/restart refreshes URL, credential and version', async t => {
    const h = await host();
    t.after(h.stop);
    assert.equal(h.enabled, true);
    assert.equal((await h.definitions()).length, 0);
    assert.equal(h.providers[0].resolveMcpServerDefinition, undefined);
    await h.enable();
    const first = (await h.definitions())[0];
    assert.equal(first.uri.scheme ?? new URL(first.uri.toString()).protocol, 'http:');
    assert.ok(first.headers.Authorization.startsWith('Nonce '));
    const client = new Client({ name: 'provider-contract-test', version: '1' });
    t.after(async () => client.close());
    await client.connect(new StreamableHTTPClientTransport(new URL(first.uri.toString()), { requestInit: { headers: first.headers, redirect: 'error' } }));
    const result = await client.callTool({ name: markerToolName });
    assert.ok(result.structuredContent && typeof result.structuredContent === 'object' && 'marker' in result.structuredContent);
    const marker = result.structuredContent.marker;
    assert.equal(typeof marker, 'string');
    assert.ok(h.logs.some(log => log.includes(String(marker))));
    assert.ok(h.logs.every(log => !log.includes(first.headers.Authorization) && !log.includes(first.uri.toString())));
    await h.disable();
    assert.equal((await h.definitions()).length, 0);
    await h.enable();
    const second = (await h.definitions())[0];
    assert.notEqual(second.version, first.version);
    assert.notEqual(second.headers.Authorization, first.headers.Authorization);
    const response = await fetch(second.uri.toString(), { headers: first.headers });
    assert.equal(response.status, 401);
    await response.text();
});

void test('trust, remote, folder changes and cancelled consent never publish a listener', async t => {
    const h = await host();
    t.after(h.stop);
    h.workspace.isTrusted = false;
    await assert.rejects(h.enable(), /trusted local folder/);
    h.workspace.isTrusted = true;
    h.env.remoteName = 'ssh';
    await assert.rejects(h.enable(), /trusted local folder/);
    h.env.remoteName = undefined;
    h.confirm(async () => undefined);
    await h.enable();
    assert.equal((await h.definitions()).length, 0);
    h.confirm(async () => 'Enable for this window');
    await h.enable();
    assert.equal((await h.definitions()).length, 1);
    h.foldersChanged.fire();
    assert.equal((await h.definitions()).length, 0);
});

void test('stop while consent is pending prevents late publication', async t => {
    const h = await host();
    t.after(h.stop);
    let approve: (value: string) => void = () => { throw new Error('Not awaiting consent'); };
    h.confirm(() => new Promise<string>(resolve => { approve = resolve; }));
    const enabling = h.enable();
    await h.disable();
    approve('Enable for this window');
    await enabling;
    assert.equal((await h.definitions()).length, 0);
});

void test('unchanged installed provider publishes a placeholder and starts IPC only during resolve', async () => {
    const require = createRequire(__filename);
    const entry = require.resolve('@microsoft/vscode-inproc-mcp/vscode').replace(/index\.js$/, 'registerMcpHttpProvider.js');
    const source = await readFile(entry, 'utf8');
    let provider: vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition> | undefined;
    let starts = 0;
    const module = { exports: {} };
    const fakeVscode = {
        Uri: { from: ({ scheme, authority }: { scheme: string; authority: string }) => new URL(`${scheme}://${authority}`) },
        McpHttpServerDefinition: class {
            public constructor(public label: string, public uri: URL, public headers: Record<string, string> | undefined) { }
        },
        lm: {
            registerMcpServerDefinitionProvider: (_id: string, value: typeof provider) => {
                provider = value;
                return { dispose: () => undefined };
            },
        },
    };
    runInNewContext(source, {
        module, exports: module.exports,
        require: (id: string) => {
            if (id === 'vscode') {
                return fakeVscode;
            }
            if (id === './inProcHttpServer') {
                return {
                    startInProcHttpServer: async () => {
                        starts++;
                        return { disposable: { dispose: () => undefined }, serverUri: new URL('unix:/test-only.sock#/mcp'), headers: { Authorization: 'Nonce fixture-not-a-credential' } };
                    },
                };
            }
            throw new Error(`Unexpected installed provider dependency: ${id}`);
        },
    });
    const installed = module.exports as typeof import('@microsoft/vscode-inproc-mcp/vscode');
    const context: Partial<vscode.ExtensionContext> = { subscriptions: [] };
    installed.registerMcpHttpProvider(context as vscode.ExtensionContext, {
        id: 'test', serverLabel: 'test', serverVersion: '1', registerTools: () => undefined,
    });
    assert.ok(provider);
    const token: vscode.CancellationToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) };
    const definitions = await provider.provideMcpServerDefinitions(token);
    assert.ok(definitions);
    assert.equal(definitions[0].uri.toString(), 'http://invalid.invalid/');
    assert.equal(definitions[0].headers, undefined);
    assert.equal(starts, 0);
    assert.ok(provider.resolveMcpServerDefinition);
    await provider.resolveMcpServerDefinition(definitions[0], token);
    assert.equal(starts, 1);
    assert.equal(new URL(definitions[0].uri.toString()).protocol, 'unix:');
});
