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
        vscode.authentication.onDidChangeSessions,
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

        // Get tenantId from idToken or config override
        const tenantId = getTenantId(session, context);

        // AuthenticationRecord structure
        const authRecord = {
            username: session.account.label,
            authority: 'https://login.microsoftonline.com', // VS Code auth provider default
            homeAccountId: `${session.account.id}`,
            tenantId,
            // This is the public client ID used by VS Code for Microsoft authentication.
            // See: https://github.com/microsoft/vscode/blob/973a531c70579b7a51544f32931fdafd32de285e/extensions/microsoft-authentication/src/AADHelper.ts#L21
            clientId: 'aebc6443-996d-45c2-90f0-388ff96faa56',
            datetime: new Date().toISOString() // Current UTC time in ISO8601 format
        };

        // Export the auth record to the user's .azure directory
        await persistAuthRecord(authRecord);
    } catch (err) {
        ext.outputChannel.appendLine(`Error exporting auth record: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// Helper to get tenantId from session or config override
function getTenantId(session: unknown, context?: IActionContext): string | undefined {
    let tenantFromArg: string | undefined = undefined;
    try {
        // This handles the case if an error is thrown, if the configuration is not registered by any extension
        tenantFromArg = vscode.workspace.getConfiguration().get<string>('@azure.argTenant');
    } catch (err) {
        // If the configuration is not found, ignore and proceed
        ext.outputChannel.appendLine('No @azure.argTenant configuration found. Proceeding without tenant override.');
    }
    if (tenantFromArg) {
        return tenantFromArg;
    }
    return extractTenantIdFromIdToken(session, context);
}

// Helper to extract tenantId (tid) from the idToken of a VS Code authentication session (For MS Auth, this will be present).
function extractTenantIdFromIdToken(session: unknown, context?: IActionContext): string | undefined {
    const idToken = (session as { idToken?: unknown }).idToken;
    if (typeof idToken === 'string') {
        const parts = idToken.split('.');
        if (parts.length === 3) {
            try {
                const payloadStr = Buffer.from(parts[1], 'base64').toString('utf8');
                const payload = JSON.parse(payloadStr) as Record<string, unknown>;
                if (typeof payload.tid === 'string') {
                    return payload.tid;
                }
            } catch (e) {
                ext.outputChannel.appendLine('Failed to parse idToken for tenantId.');
                if (context) {
                    context.telemetry.properties.result = 'Failed';
                }
            }
        }
    }
    return undefined;
}

// Helper to persist the authentication record to the user's .azure directory
async function persistAuthRecord(authRecord: Record<string, unknown>): Promise<void> {
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
    const authDir = path.join(baseAzureDir, 'ms-azuretools.vscode-azureresourcegroups');
    const authRecordPath = path.join(authDir, 'authRecord.json');

    // Ensure directory exists (async)
    await fs.ensureDir(authDir);

    // Write auth record (async)
    await fs.writeFile(authRecordPath, JSON.stringify(authRecord, null, 2));
    ext.outputChannel.appendLine(`Authentication record exported to: ${authRecordPath}`);
}
