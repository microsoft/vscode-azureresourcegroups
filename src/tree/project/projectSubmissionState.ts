/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { hasPendingProjectSubmissionContextKey } from '../../constants';

/**
 * Tracks whether the user has submitted a "Create with Copilot" prompt but the
 * resulting plan file hasn't been written yet. Used to keep the Azure Project
 * tree view visible so the UI doesn't snap back to the "Create New Project" welcome content.
 * Resets when a plan file appears or when VS Code restarts (intentionally in-memory only).
 */
class ProjectSubmissionState {
    private _isPending = false;
    private readonly _emitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this._emitter.event;

    get isPending(): boolean {
        return this._isPending;
    }

    setPending(): void {
        if (this._isPending) {
            return;
        }
        this._isPending = true;
        void vscode.commands.executeCommand('setContext', hasPendingProjectSubmissionContextKey, true);
        this._emitter.fire();
    }

    reset(): void {
        if (!this._isPending) {
            return;
        }
        this._isPending = false;
        void vscode.commands.executeCommand('setContext', hasPendingProjectSubmissionContextKey, false);
        this._emitter.fire();
    }
}

export const projectSubmissionState = new ProjectSubmissionState();
