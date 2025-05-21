import { IActionContext } from '@microsoft/vscode-azext-utils';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from './extensionVariables';

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

        // Default tenant from session
        // Example session.account.id: '1234a567-891b-2e34-a5cf-678912345fc6.72f988bf-86f1-41af-91ab-2d7cd011db47'
        // The tenantId is the second segment when splitting by '.'
        const defaultTenantId = session.account.id.split('.')[1];

        // Check if extension context args contain tenant override
        const tenantFromArg = vscode.workspace.getConfiguration().get<string>('@azure.argTenant');

        const effectiveTenantId = tenantFromArg || defaultTenantId;

        // AuthenticationRecord structure
        const authRecord = {
            username: session.account.label,
            authority: 'https://login.microsoftonline.com', // VS Code auth provider default
            homeAccountId: `${session.account.id}`,
            tenantId: effectiveTenantId,
            clientId: 'aebc6443-996d-45c2-90f0-388ff96faa56' // VS Code client ID
        };


        // Write to a well-known location in .azure home directory (handle both .azure and .Azure for cross-platform compatibility)
        // If either exists, use it; otherwise, create .azure
        // This ensures a consistent, well-known location for other tools and applications to store and retrieve authentication records.
        // Allows tools to write auth records to a central location for other apps to read from.
        // Didn't use GlobalStorage path, as that brings added risk of regressions for auth record location which is used by external tools and apps, if the location changes in the future.
        const homeDir = os.homedir();
        let azureDir = path.join(homeDir, '.azure');
        let altAzureDir = path.join(homeDir, '.Azure');
        let baseAzureDir: string;
        if (fs.existsSync(azureDir)) {
            baseAzureDir = azureDir;
        } else if (fs.existsSync(altAzureDir)) {
            baseAzureDir = altAzureDir;
        } else {
            baseAzureDir = azureDir;
            fs.ensureDirSync(baseAzureDir);
        }
        const authDir = path.join(baseAzureDir, 'auth-records', 'ms-azuretools.vscode-azureresourcegroups');
        const authRecordPath = path.join(authDir, 'authRecord.json');

        // Ensure directory exists (sync is fine here)
        fs.ensureDirSync(authDir);

        // Write auth record (async)
        await fs.writeFile(authRecordPath, JSON.stringify(authRecord, null, 2));
        ext.outputChannel.appendLine(`Authentication record exported to: ${authRecordPath}`);
    } catch (err) {
        ext.outputChannel.appendLine(`Error exporting auth record: ${err instanceof Error ? err.message : String(err)}`);
    }
}
