/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { getTestApi } from '../utils/testApiAccess';

async function waitForNextStepsTab(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            subscription.dispose();
            reject(new Error('Next steps tab did not become visible'));
        }, 5_000);
        const check = (): void => {
            if (vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.label === 'Next steps')) {
                clearTimeout(timer);
                subscription.dispose();
                resolve();
            }
        };
        const subscription = vscode.window.tabGroups.onDidChangeTabs(check);
        check();
    });
}

export async function run(): Promise<void> {
    const api = await getTestApi();
    assert.equal(vscode.workspace.isTrusted, true, 'Trust the dedicated empty fixture before running the extension test');
    assert.equal(vscode.env.remoteName, undefined);
    assert.equal(api.testing.experimentalMcpHttp.getDefinition(), undefined);
    await vscode.commands.executeCommand('azureResourceGroups.experimentalMcpHttp.enable');
    const definition = api.testing.experimentalMcpHttp.getDefinition();
    assert.ok(definition, 'No connection-ready definition after explicit test enablement');
    assert.equal(definition.uri.authority.startsWith('127.0.0.1:'), true);
    const client = new Client({ name: 'actual-extension-host-test', version: '1' }, {
        versionNegotiation: { mode: 'auto', probe: { timeoutMs: 1_000, maxRetries: 0 } },
    });
    const transport = new StreamableHTTPClientTransport(new URL(definition.uri.toString()), {
        requestInit: { headers: definition.headers, redirect: 'error' },
        reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 50, maxReconnectionDelay: 50, reconnectionDelayGrowFactor: 1 },
    });
    try {
        await client.connect(transport);
        assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), [
            'experimental_loopback_instance_marker', 'open_scaffold_next_steps_view',
        ]);
        const marker = await client.callTool({ name: 'experimental_loopback_instance_marker', arguments: {} });
        const commandMarker = await vscode.commands.executeCommand('azureResourceGroups.experimentalMcpHttp.instanceMarker');
        assert.deepEqual(marker.structuredContent, { marker: commandMarker });
        assert.equal(api.testing.experimentalMcpHttp.isNextStepsViewOpen(), false);
        const view = await client.callTool({ name: 'open_scaffold_next_steps_view', arguments: {} });
        assert.notEqual(view.isError, true);
        assert.equal(api.testing.experimentalMcpHttp.isNextStepsViewOpen(), true);
        await waitForNextStepsTab();
        await vscode.commands.executeCommand('azureResourceGroups.experimentalMcpHttp.stop');
        assert.equal(api.testing.experimentalMcpHttp.getDefinition(), undefined);
        await assert.rejects(fetch(definition.uri.toString(), { headers: definition.headers, signal: AbortSignal.timeout(1_000) }));
        console.log('Extension-host runtime:', JSON.stringify({
            node: process.version, electron: process.versions.electron, platform: process.platform, architecture: process.arch, vscode: vscode.version,
        }));
        console.log('PASS actual extension host: authenticated SDK initialization, exact catalog, fixed command marker, existing visible Next Steps tab, revocation and disposal. Copilot Chat was not tested.');
    } finally {
        await client.close();
        await vscode.commands.executeCommand('azureResourceGroups.experimentalMcpHttp.stop');
    }
}
