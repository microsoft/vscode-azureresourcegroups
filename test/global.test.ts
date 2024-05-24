/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestOutputChannel, TestUserInput } from '@microsoft/vscode-azext-dev';
import * as vscode from 'vscode';
import { ext, registerOnActionStartHandler, settingUtils } from '../extension.bundle';

export let longRunningTestsEnabled: boolean;
export const userSettings: { key: string, value: unknown }[] = [];
// Runs before all tests
suiteSetup(async function (this: Mocha.Context): Promise<void> {
    this.timeout(1 * 60 * 1000);

    await vscode.extensions.getExtension('ms-azuretools.vscode-azureresourcegroups')?.activate();

    await vscode.commands.executeCommand('azureResourceGroups.refresh'); // activate the extension before tests begin
    ext.outputChannel = new TestOutputChannel();

    registerOnActionStartHandler(context => {
        // Use `TestUserInput` by default so we get an error if an unexpected call to `context.ui` occurs, rather than timing out
        context.ui = new TestUserInput(vscode);
    });
    const groupBySetting = settingUtils.getWorkspaceSetting('groupBy')
    userSettings.push({ key: 'groupBy', value: groupBySetting });

    const deleteConfirmationSetting = settingUtils.getWorkspaceSetting('deleteConfirmation');
    userSettings.push({ key: 'deleteConfirmation', value: deleteConfirmationSetting });

    longRunningTestsEnabled = !/^(false|0)?$/i.test(process.env['AzCode_UseAzureFederatedCredentials'] || '');
});

suiteTeardown(async function (this: Mocha.Context): Promise<void> {
    for (const setting of userSettings) {
        // reset the settings to their original values
        console.debug(`Resetting setting '${setting.key}' to '${setting.value}'`);
        await settingUtils.updateGlobalSetting(setting.key, setting.value);
    }
});
