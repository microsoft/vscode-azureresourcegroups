/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { TestOutputChannel, TestUserInput } from 'vscode-azureextensiondev';
import { ext, IActionContext } from '../extension.bundle';

export let longRunningTestsEnabled: boolean;
export let testUserInput: TestUserInput = new TestUserInput(vscode);

export function createTestActionContext(): IActionContext {
    return { telemetry: { properties: {}, measurements: {} }, errorHandling: { issueProperties: {} } };
}

// Runs before all tests
suiteSetup(async function (this: Mocha.Context): Promise<void> {
    this.timeout(1 * 60 * 1000);

    await vscode.commands.executeCommand('azureResourceGroups.refresh'); // activate the extension before tests begin
    ext.outputChannel = new TestOutputChannel();
    ext.ui = testUserInput;

    // tslint:disable-next-line:strict-boolean-expressions
    longRunningTestsEnabled = !/^(false|0)?$/i.test(process.env.ENABLE_LONG_RUNNING_TESTS || '');
});
