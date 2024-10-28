/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext, parseError } from '@microsoft/vscode-azext-utils';
import { exec } from 'child_process';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';

// This command is meant to be called once vscode.dev connects to VS Code server running in Cloud Shell via Dev Tunnel.
// As long as we're connected, it periodically does the following:
//  1. refreshes the dev tunnel access token when connected for the VS Code Server
//  2. calls the Cloud Shell /keepAlive endpoint to ensure Cloud Shell stays active
//  3. calls the Cloud Shell /size endpoint to ensure the terminal stays active

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

interface MaintainCloudShellConnectionOptions {
    consoleUri: string;
    terminalId: string;
    templateUrl?: string;
}

export async function maintainCloudShellConnection(_context: IActionContext, options: MaintainCloudShellConnectionOptions) {

    try {
        await recordTelemetry({ templateUrl: options.templateUrl });
    } catch (e) {
        // Don't crash if telemetry fails
        ext.outputChannel.error(parseError(e).message);
    }

    while (true) {
        try {
            await refreshDevTunnelAccessToken();
        } catch (e) {
            ext.outputChannel.error(parseError(e).message);
        }

        try {
            await cloudShellKeepAlive(options.consoleUri);
        } catch (e) {
            ext.outputChannel.error(parseError(e).message);
        }

        try {
            await cloudShellSize(options.consoleUri, options.terminalId);
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
        ext.outputChannel.debug('Running tunnel user login...');
        const codeCli = 'vscode';
        exec(`${codeCli} tunnel user login --provider microsoft --access-token ${session.accessToken}`,
            (error, stdout, stderr) => {
                if (error) {
                    ext.outputChannel.error('Failed to run tunnel user login');
                    ext.outputChannel.error(stderr);
                    ext.outputChannel.error(stdout);
                }
                ext.outputChannel.debug('Successfully ran tunnel user login.');
            }
        );
    }
}

async function cloudShellKeepAlive(consoleUri: string) {
    const session = await vscode.authentication.getSession('microsoft', ['https://management.core.windows.net//.default'], { silent: true });
    const accessToken = session?.accessToken;

    if (!accessToken) {
        ext.outputChannel.error('Failed to get access token.');
        return;
    }
    const response = await fetch(`${consoleUri}/keepAlive`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({}),
    });

    if (response.ok) {
        ext.outputChannel.debug('Successfully called Cloud Shell keepAlive endpoint.');
    } else {
        ext.outputChannel.error('Failed to call Cloud Shell keepAlive endpoint.');
        ext.outputChannel.error(response.statusText);
        ext.outputChannel.error(await response.text());
    }
}

async function cloudShellSize(consoleUri: string, terminalId: string): Promise<void> {
    const session = await vscode.authentication.getSession('microsoft', ['https://management.core.windows.net//.default'], { silent: true });
    const accessToken = session?.accessToken;

    if (!accessToken) {
        ext.outputChannel.error('Failed to get access token.');
        return;
    }

    const sizeResponse = await fetch(`${consoleUri}/terminals/${terminalId}/size?cols=68&rows=15&api-version=2019-01-01`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({}),
    });

    if (sizeResponse.ok) {
        ext.outputChannel.debug('Successfully called Cloud Shell size endpoint.');
    } else {
        ext.outputChannel.error('Failed to call Cloud Shell size endpoint.');
        ext.outputChannel.error(sizeResponse.statusText);
        ext.outputChannel.error(await sizeResponse.text());
    }
}

async function recordTelemetry(options: { templateUrl?: string }) {
    await callWithTelemetryAndErrorHandling('vscode-dev-azure.cloudShellConnection', async (context) => {
        if (options.templateUrl) {
            context.telemetry.properties.templateUrl = options.templateUrl;
        }
    });
}
