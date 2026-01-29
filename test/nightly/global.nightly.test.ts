/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { longRunningTestsEnabled } from '../global.test';
import { setupAzureDevOpsSubscriptionProvider } from '../utils/azureDevOpsSubscriptionProvider';

export const resourceGroupsToDelete: string[] = [];

// Runs before all nightly tests
suiteSetup(async function (this: Mocha.Context): Promise<void> {
    if (longRunningTestsEnabled) {
        this.timeout(2 * 60 * 1000);

        // Set up Azure DevOps subscription provider for federated credentials
        const useAzureFederatedCredentials: boolean = !/^(false|0)?$/i.test(process.env['AzCode_UseAzureFederatedCredentials'] || '');
        if (useAzureFederatedCredentials) {
            await setupAzureDevOpsSubscriptionProvider();
        }

        await vscode.commands.executeCommand('azureResourceGroups.logIn');
    }
});

