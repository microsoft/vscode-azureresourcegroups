/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext, parseError } from '@microsoft/vscode-azext-utils';
import { exec } from 'child_process';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';

// This command is meant to be called once vscode.dev connects to VS Code server running in Cloud Shell via Dev Tunnel.
// As long as we're connected, it periodically does the following:
//  1. refreshes the dev tunnel access token when connected to VS Code Server running in Cloud Shell
//  2. calls the Cloud Shell /keepAlive endpoint to ensure Cloud Shell stays active

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

interface MaintainCloudShellConnectionOptions {
    consoleUri: string;
}

export async function maintainCloudShellConnection(_context: IActionContext, options: MaintainCloudShellConnectionOptions) {
    while (true) {
        try {
            await refreshDevTunnelAccessToken();
            await cloudShellKeepAlive(options.consoleUri);
        } catch (e) {
            ext.outputChannel.error(parseError(e).message);
        }
        await delay(1000 * 60 * 10 /* 10 minutes */);
    }
}

export async function refreshDevTunnelAccessToken() {
    const devTunnelsProdAppId = '46da2f7e-b5ef-422a-88d4-2a7f9de6a0b2';
    const session = await vscode.authentication.getSession('microsoft', [`${devTunnelsProdAppId}/.default`], { silent: true });
    if (!session) {
        ext.outputChannel.error('Failed to refresh Dev Tunnel access token.');
    } else {
        ext.outputChannel.appendLog('Running tunnel user login...');
        const codeCli = 'vscode';
        exec(`${codeCli} tunnel user login --provider microsoft --access-token ${session.accessToken}`,
            (error, stdout, stderr) => {
                if (error) {
                    ext.outputChannel.error('Failed to run tunnel user login');
                    ext.outputChannel.error(stderr);
                    ext.outputChannel.error(stdout);
                }
                ext.outputChannel.appendLine('Successfully ran tunnel user login.');
            }
        );
    }
}

async function cloudShellKeepAlive(consoleUri: string) {
    // POST /providers/Microsoft.Portal/consoles/{consoleName}/keepAlive

    const session = await vscode.authentication.getSession('microsoft', ['https://management.core.windows.net//.default'], { silent: true });
    const accessToken = session?.accessToken;

    if (accessToken) {
        const keepAliveUrl = `${consoleUri}/keepAlive`;
        const keepAliveHeaders = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        const response = await fetch(keepAliveUrl, {
            method: 'POST',
            headers: keepAliveHeaders,
            body: JSON.stringify({}),
        });

        if (response.ok) {
            ext.outputChannel.appendLine('Successfully called Cloud Shell keepAlive endpoint.');
        } else {
            ext.outputChannel.error('Failed to call Cloud Shell keepAlive endpoint.');
            ext.outputChannel.error(response.statusText);
            ext.outputChannel.error(await response.text());
        }
    }
}
