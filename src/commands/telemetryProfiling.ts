/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { TelemetryProfiler } from '../debug/TelemetryProfiler';
import { ext } from '../extensionVariables';

export async function startTelemetryProfiling(_context: IActionContext): Promise<void> {
    const profiler = TelemetryProfiler.getInstance();
    ext.context.subscriptions.push(profiler);
    profiler.start();
}

export async function stopTelemetryProfiling(_context: IActionContext): Promise<void> {
    const profiler = TelemetryProfiler.getInstance();
    const uri = await profiler.stop();

    if (uri) {
        ext.outputChannel.appendLog(`Telemetry profile written to: ${uri.fsPath}`);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
    }
}
