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

        const session = await getAuthenticationSession(AUTH_PROVIDER_ID, SCOPES);

        if (!session) {
            // If no session is found, clean up any existing auth record and exit
            await cleanupAuthRecordIfPresent();
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
    const baseAzureDir = await getAzureDir();
    const authDir = path.join(baseAzureDir, 'ms-azuretools.vscode-azureresourcegroups');
    const authRecordPath = path.join(authDir, 'authRecord.json');
    const gitignorePath = path.join(authDir, '.gitignore');

    // Ensure directory exists (async)
    await fs.ensureDir(authDir);

    // Only write .gitignore if it doesn't exist or doesn't contain the required rule
    const gitignoreContent = `# Ignore all authentication records in this directory\nauthRecord.json\n# Do not ignore this .gitignore file itself\n!.gitignore\n`;
    let shouldWriteGitignore = true;
    if (await fs.pathExists(gitignorePath)) {
        const existing = await fs.readFile(gitignorePath, 'utf8');
        if (existing.includes('authRecord.json')) {
            shouldWriteGitignore = false;
        }
    }
    if (shouldWriteGitignore) {
        await fs.writeFile(gitignorePath, gitignoreContent);
    }

    // Write auth record (async)
    await fs.writeFile(authRecordPath, JSON.stringify(authRecord, null, 2));
}

// Helper to get the base Azure directory (.azure or .Azure) in the user's home directory
async function getAzureDir(): Promise<string> {
    const homeDir = os.homedir();
    const azureDir = path.join(homeDir, '.azure');
    const altAzureDir = path.join(homeDir, '.Azure');
    if (await fs.pathExists(azureDir)) {
        return azureDir;
    } else if (await fs.pathExists(altAzureDir)) {
        return altAzureDir;
    } else {
        await fs.ensureDir(azureDir);
        return azureDir;
    }
}

// Helper to clean up the persisted auth record if present
async function cleanupAuthRecordIfPresent(): Promise<void> {
    const baseAzureDir = await getAzureDir();
    const authDir = path.join(baseAzureDir, 'ms-azuretools.vscode-azureresourcegroups');
    const authRecordPath = path.join(authDir, 'authRecord.json');
    if (await fs.pathExists(authRecordPath)) {
        await fs.remove(authRecordPath);
    }
}

// Helper to get the authentication session for the given auth provider and scopes
async function getAuthenticationSession(
    authProviderId: string,
    scopes: string[]
): Promise<vscode.AuthenticationSession | undefined> {
    const allAccounts = await vscode.authentication.getAccounts(authProviderId);

    // Try to get the current authentication session silently.
    let session = await vscode.authentication.getSession(
        authProviderId,
        scopes,
        { silent: true }
    );

    if (session) {
        // Ensure session represents the active accounts. (i.e. not a user being logged out.)
        const isLoggedIn = allAccounts.some(account => account.id === session?.account.id);
        if (!isLoggedIn) {
            session = undefined; // Reset session if it doesn't match any active account, as it represents a user being logged out.
        }
    }

    if (!session && allAccounts.length > 0) {
        // no active session found, but accounts exist
        // Get the first available session for the active accounts.
        for (const account of allAccounts) {
            session = await vscode.authentication.getSession(
                authProviderId,
                scopes,
                { silent: true, account }
            );
            if (session) {
                break;
            }
        }
    }

    return session;
}
