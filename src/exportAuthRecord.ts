/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext, registerEvent } from '@microsoft/vscode-azext-utils';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import type { ExtensionContext } from 'vscode';
import * as vscode from 'vscode';
import { ext } from './extensionVariables';

/**
 * Registers the exportAuthRecord callback for session changes and ensures the auth record is exported at least once on activation.
 */
export function registerExportAuthRecordOnSessionChange(_context: ExtensionContext) {
    registerEvent(
        'treeView.onDidChangeSessions',
        (vscode as typeof import('vscode')).authentication.onDidChangeSessions,
        exportAuthRecord
    );

    // Also call exportAuthRecord once on activation to ensure the auth record is exported at least once
    // (onDidChangeSessions is not guaranteed to fire on activation)
    void callWithTelemetryAndErrorHandling('azureResourceGroups.exportAuthRecord', async (actionContext) => {
        await exportAuthRecord(actionContext);
    });
}

/**
 * Exports the current authentication record to a well-known location in the user's .azure directory.
 * Used for interoperability with other tools and applications.
 */
export async function exportAuthRecord(context: IActionContext): Promise<void> {
    const AUTH_PROVIDER_ID = 'microsoft'; // VS Code Azure auth provider
    const SCOPES = ['https://management.azure.com/.default']; // Default ARM scope

    context.errorHandling.suppressDisplay = true;
    context.telemetry.suppressIfSuccessful = true;
    context.telemetry.properties.isActivationEvent = 'true';

    try {
        // Use silent: true to avoid prompting the user unexpectedly
        const session = await vscode.authentication.getSession(
            AUTH_PROVIDER_ID,
            SCOPES,
            { silent: true }
        );

        if (!session) {
            ext.outputChannel.appendLine('No session available for Azure account.');
            return;
        }

        // Fetch tenantId from idToken (Microsoft auth always provides it with OpenID scopes)
        let defaultTenantId: string | undefined = undefined;
        // VS Code AuthenticationSession does not officially expose idToken, but it is present for Microsoft auth
        // Use type assertion to access it, but avoid 'any' for lint compliance
        const idToken = (session as { idToken?: unknown }).idToken;
        if (typeof idToken === 'string') {
            const parts = idToken.split('.');
            if (parts.length === 3) {
                try {
                    const payloadStr = Buffer.from(parts[1], 'base64').toString('utf8');
                    const payload: Record<string, unknown> = JSON.parse(payloadStr);
                    if (typeof payload.tid === 'string') {
                        defaultTenantId = payload.tid;
                    }
                } catch (e) {
                    ext.outputChannel.appendLine('Failed to parse idToken for tenantId.');
                }
            }
        }

        // Check if extension context args contain tenant override
        const tenantFromArg = vscode.workspace.getConfiguration().get<string>('@azure.argTenant');
        const tenantId = tenantFromArg || defaultTenantId;

        // AuthenticationRecord structure
        const authRecord = {
            username: session.account.label,
            authority: 'https://login.microsoftonline.com', // VS Code auth provider default
            homeAccountId: `${session.account.id}`,
            tenantId,
            clientId: 'aebc6443-996d-45c2-90f0-388ff96faa56' // VS Code client ID
        };

        // Write to a well-known location in .azure home directory (handle both .azure and .Azure for cross-platform compatibility)
        // If either exists, use it; otherwise, create .azure
        // This ensures a consistent, well-known location for other tools and applications to store and retrieve authentication records.
        // Allows tools to write auth records to a central location for other apps to read from.
        // Didn't use GlobalStorage path, as that brings added risk of regressions for auth record location which is used by external tools and apps, if the location changes in the future.
        const homeDir = os.homedir();
        const azureDir = path.join(homeDir, '.azure');
        const altAzureDir = path.join(homeDir, '.Azure');
        let baseAzureDir: string;
        if (await fs.pathExists(azureDir)) {
            baseAzureDir = azureDir;
        } else if (await fs.pathExists(altAzureDir)) {
            baseAzureDir = altAzureDir;
        } else {
            baseAzureDir = azureDir;
            await fs.ensureDir(baseAzureDir);
        }
        const authDir = path.join(baseAzureDir, 'auth-records', 'ms-azuretools.vscode-azureresourcegroups');
        const authRecordPath = path.join(authDir, 'authRecord.json');

        // Ensure directory exists (async)
        await fs.ensureDir(authDir);

        // Write auth record (async)
        await fs.writeFile(authRecordPath, JSON.stringify(authRecord, null, 2));
        ext.outputChannel.appendLine(`Authentication record exported to: ${authRecordPath}`);
    } catch (err) {
        ext.outputChannel.appendLine(`Error exporting auth record: ${err instanceof Error ? err.message : String(err)}`);
    }
}
