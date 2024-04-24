/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReadStream } from "node:fs";
import { CancellationToken, Event, Progress, Terminal, TerminalProfile } from "vscode";

export interface UploadOptions {
    contentLength?: number;
    progress?: Progress<{ message?: string; increment?: number }>;
    token?: CancellationToken;
}

export interface CloudShell {
    readonly status: CloudShellStatus;
    readonly onStatusChanged: Event<CloudShellStatus>;
    readonly waitForConnection: () => Promise<boolean>;
    readonly terminal: Promise<Terminal>;
    // readonly session: Promise<AzureSession>;
    readonly uploadFile: (filename: string, stream: ReadStream, options?: UploadOptions) => Promise<void>;
}

export type CloudShellStatus = 'Connecting' | 'Connected' | 'Disconnected';

export interface CloudShellInternal extends Omit<CloudShell, 'terminal'> {
    status: CloudShellStatus;
    terminal?: Promise<Terminal>;
    terminalProfile?: Promise<TerminalProfile>;
}
