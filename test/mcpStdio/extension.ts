/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { strict as assert } from 'node:assert';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as vscode from 'vscode';
import { z } from 'zod';
import { leaseEnvironmentKey, readLease } from '../../src/mcp/stdioPrototype/connection';

const configSchema = z.object({
    mcpServers: z.record(z.string(), z.object({ command: z.string(), args: z.array(z.string()), env: z.record(z.string(), z.string()) })),
});

export async function run(): Promise<void> {
    const artifactDirectory = process.env.AZURE_RESOURCES_MCP_ARTIFACTS;
    assert(artifactDirectory, 'Launch with test:mcp-stdio:extension');
    if (!vscode.workspace.isTrusted) {
        console.log('Waiting for the user to trust this disposable prototype workspace.');
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                subscription.dispose();
                reject(new Error('Workspace Trust is required for the prototype extension test.'));
            }, 60_000);
            const subscription = vscode.workspace.onDidGrantWorkspaceTrust(() => {
                clearTimeout(timer);
                subscription.dispose();
                resolve();
            });
        });
    }
    const extension = vscode.extensions.getExtension('ms-azuretools.vscode-azureresourcegroups');
    assert(extension, 'Development extension must be present');
    await extension.activate();
    const pair = await vscode.commands.executeCommand<{ configPath: string; instance: string }>('copilotOnRails.pairMcpStdioPrototype');
    assert(pair, 'Activation must register the prototype pairing command');
    assert.equal((await stat(pair.configPath)).mode & 0o777, 0o600);
    const config = configSchema.parse(JSON.parse(await readFile(pair.configPath, 'utf8')));
    const definition = config.mcpServers['azure-resources-stdio-prototype'];
    assert.equal(definition.command, process.execPath);
    assert.equal(definition.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(definition.env.ELECTRON_NO_ASAR, '1');
    const lease = readLease(definition.env[leaseEnvironmentKey]);
    assert.equal(lease.instance, pair.instance);
    let errors = '';
    const transport = new StdioClientTransport({ ...definition, stderr: 'pipe' });
    transport.stderr?.on('data', chunk => { errors += String(chunk); });
    const client = new Client({ name: 'prototype-extension-host-test', version: '1' });
    try {
        await client.connect(transport);
        const tools = await client.listTools();
        assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['cor_stdio_probe', 'open_scaffold_next_steps_view']);
        const probe = await client.callTool({ name: 'cor_stdio_probe', arguments: { instance: pair.instance } });
        assert.deepEqual(probe.structuredContent, { instance: pair.instance, count: 1 });
        const failure = await client.callTool({ name: 'cor_stdio_probe', arguments: { instance: pair.instance, action: 'fail' } });
        assert.equal(failure.isError, true);
        const abort = new AbortController();
        const cancel = assert.rejects(client.callTool({
            name: 'cor_stdio_probe', arguments: { instance: pair.instance, delayMs: 1000 },
        }, { signal: abort.signal }));
        await delay(100);
        abort.abort();
        await cancel;
        await delay(1100);
        const nextProbe = await client.callTool({ name: 'cor_stdio_probe', arguments: { instance: pair.instance } });
        assert.deepEqual(nextProbe.structuredContent, { instance: pair.instance, count: 2 });
        const invalidView = await client.callTool({ name: 'open_scaffold_next_steps_view', arguments: { commandId: 'workbench.action.quit' } });
        assert.equal(invalidView.isError, true);
        assert(!vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.label === 'Next steps')));
        const view = await client.callTool({ name: 'open_scaffold_next_steps_view', arguments: {} });
        assert.notEqual(view.isError, true);
        await delay(500);
        assert(vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.label === 'Next steps' && tab.input instanceof vscode.TabInputWebview)));
        assert(!errors.includes(lease.authorization) && !errors.includes(lease.uri));
        await writeFile(join(artifactDirectory, 'extension-result.json'), JSON.stringify({
            status: 'pass', vscode: vscode.version, node: process.version, platform: process.platform, arch: process.arch,
            extensionPath: extension.extensionPath, instance: pair.instance,
            tools: tools.tools.map(tool => tool.name), commandEffects: 2, cancellationPreventedEffect: true,
            nextStepsWebviewTab: true, copilotModelInvocation: 'not tested',
        }, undefined, 2));
    } finally {
        await transport.close();
    }
}
