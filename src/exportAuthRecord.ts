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
 * Thread-safe state manager for authentication accounts
 */
class AuthAccountStateManager {
    private static instance: AuthAccountStateManager;
    private accountsCache: readonly vscode.AuthenticationSessionAccountInformation[] = [];
    private isUpdating: boolean = false;
    private pendingPromise: Promise<readonly vscode.AuthenticationSessionAccountInformation[]> | null = null;

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    private constructor() { }

    public static getInstance(): AuthAccountStateManager {
        if (!AuthAccountStateManager.instance) {
            AuthAccountStateManager.instance = new AuthAccountStateManager();
        }
        return AuthAccountStateManager.instance;
    }

    /**
     * Get accounts with thread-safe access. If an update is in progress, waits for it to complete.
     * Returns accounts along with change detection (new accounts added, accounts removed).
     */
    public async getAccounts(authProviderId: string): Promise<{
        accounts: readonly vscode.AuthenticationSessionAccountInformation[];
        hasNewAccounts: boolean;
        accountsRemoved: boolean;
    }> {
        // If there's already a pending fetch, wait for it
        if (this.pendingPromise) {
            const accounts = await this.pendingPromise;
            return { accounts, hasNewAccounts: false, accountsRemoved: false }; // Already processed
        }

        // If we're currently updating, create a promise that waits for the update to finish
        if (this.isUpdating) {
            const waitPromise = new Promise<readonly vscode.AuthenticationSessionAccountInformation[]>((resolve) => {
                const checkInterval = setInterval(() => {
                    if (!this.isUpdating) {
                        clearInterval(checkInterval);
                        resolve(this.accountsCache);
                    }
                }, 10);
            });
            const accounts = await waitPromise;
            return { accounts, hasNewAccounts: false, accountsRemoved: false }; // Already processed
        }

        // Fetch fresh accounts
        this.isUpdating = true;
        const previousAccountIds = new Set(this.accountsCache.map(acc => acc.id));
        const previousCount = this.accountsCache.length;

        this.pendingPromise = (async () => {
            try {
                const accounts = await vscode.authentication.getAccounts(authProviderId);
                this.accountsCache = accounts;
                return accounts;
            } finally {
                this.isUpdating = false;
                this.pendingPromise = null;
            }
        })();

        const accounts = await this.pendingPromise;

        // Check if there are any new accounts
        const hasNewAccounts = accounts.some(acc => !previousAccountIds.has(acc.id));

        // Check if any accounts were removed (sign-out event)
        // Either count decreased or some previous account IDs are no longer present
        const accountsRemoved = accounts.length < previousCount;

        return { accounts, hasNewAccounts, accountsRemoved };
    }

    /**
     * Get cached accounts without fetching. Returns empty array if not yet fetched.
     */
    public getCachedAccounts(): readonly vscode.AuthenticationSessionAccountInformation[] {
        return [...this.accountsCache];
    }

    /**
     * Clear the cached accounts state
     */
    public clearCache(): void {
        this.accountsCache = [];
    }
}

const AUTH_RECORD_README = `
The \`authRecord.json\` file is created after authenticating to an Azure subscription from Visual Studio Code (VS Code). For example, via the **Azure: Sign In** command in Command Palette. The directory in which the file resides matches the unique identifier of the [Azure Resources extension](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azureresourcegroups) responsible for writing the file.

### Purpose of \`authRecord.json\`

This file plays a key role in enabling a seamless single sign-on experience in the local development environment for VS Code customers. The file is used to persist a serialized representation of an [AuthenticationRecord](https://learn.microsoft.com/javascript/api/@azure/identity/authenticationrecord?view=azure-node-latest) object, which includes metadata about a previously authenticated user session. More specifically, the file:

- Allows products like the Azure Identity SDK and Azure MCP Server to reuse authentication state without prompting the user to sign in again.
- Enables the Azure Identity SDK's \`DefaultAzureCredential()\` chain to automatically authenticate users in dev loops, especially when running inside VS Code.

### What it contains

The file does **not** contain access tokens or secrets. This design avoids the security risks associated with storing sensitive credentials on disk. The table below describes the file's properties.

| Key             | Description                                                         |
|-----------------|---------------------------------------------------------------------|
| \`authority\`     | The Microsoft Entra authority used for authentication               |
| \`clientId\`      | The client ID of the app that performed the original authentication |
| \`tenantId\`      | The associated Microsoft Entra tenant ID                            |
| \`username\`      | The username of the logged in account                               |
| \`homeAccountId\` | A unique identifier for the account                                 |

### Security considerations

- The user profile's \`.azure\` directory is already used by other products, such as MSAL and Azure CLI to store metadata in \`msal_token_cache.bin\` and \`azureProfile.json\`, respectively.
- While \`authRecord.json\` itself isn't inherently dangerous, it should still be excluded from source control. A preconfigued \`.gitignore\` file is written alongside the file for that purpose.
`;

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
 * Get the singleton instance of AuthAccountStateManager for managing authentication accounts state.
 * This provides thread-safe access to accounts fetched during auth record persistence.
 */
export function getAuthAccountStateManager(): AuthAccountStateManager {
    return AuthAccountStateManager.getInstance();
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
        // Get accounts and check for changes (new accounts added or accounts removed)
        const accountStateManager = AuthAccountStateManager.getInstance();
        const { accounts: allAccounts, hasNewAccounts, accountsRemoved } = await accountStateManager.getAccounts(AUTH_PROVIDER_ID);

        // Scenario 1: No accounts exist at all (all signed out)
        if (allAccounts.length === 0) {
            await cleanupAuthRecordIfPresent();
            return;
        }

        // Scenario 2: Accounts were removed (sign-out event) but some remain
        if (accountsRemoved && allAccounts.length > 0) {
            // Fetch session for one of the remaining accounts and export its auth record
            const session = await getAuthenticationSession(AUTH_PROVIDER_ID, SCOPES);

            if (!session) {
                // No valid session for remaining accounts
                return;
            }

            // Get tenantId from idToken or config override
            const tenantId = getTenantId(session, context);

            // AuthenticationRecord structure for the remaining account
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
            return;
        }

        // Scenario 3: No new accounts and no removals (e.g., token refresh)
        if (!hasNewAccounts && !accountsRemoved) {
            return;
        }

        // Scenario 4: New account detected - fetch session and export auth record
        const session = await getAuthenticationSession(AUTH_PROVIDER_ID, SCOPES);

        if (!session) {
            // Session could not be retrieved despite new accounts
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
    // Write README.md explaining the purpose and contents of authRecord.json
    const readmePath = path.join(authDir, 'README.md');

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
    await fs.writeFile(readmePath, AUTH_RECORD_README);
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

    // Clear the cached accounts state when cleaning up
    AuthAccountStateManager.getInstance().clearCache();
}

// Helper to get the authentication session for the given auth provider and scopes
// This should only be called when we know there are accounts
async function getAuthenticationSession(
    authProviderId: string,
    scopes: string[]
): Promise<vscode.AuthenticationSession | undefined> {
    const accountStateManager = AuthAccountStateManager.getInstance();
    const cachedAccounts = accountStateManager.getCachedAccounts();

    // Try to get the current authentication session silently.
    let session = await vscode.authentication.getSession(
        authProviderId,
        scopes,
        { silent: true }
    );

    if (session) {
        // Ensure session represents the active accounts. (i.e. not a user being logged out.)
        const isLoggedIn = cachedAccounts.some(account => account.id === session?.account.id);
        if (!isLoggedIn) {
            session = undefined; // Reset session if it doesn't match any active account, as it represents a user being logged out.
        }
    }

    if (!session && cachedAccounts.length > 0) {
        // no active session found, but accounts exist
        // Get the first available session for the active accounts.
        for (const account of cachedAccounts) {
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
