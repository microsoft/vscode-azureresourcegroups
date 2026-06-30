/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { hasPendingProjectSubmissionContextKey } from '../../constants';
import { type ProjectStage } from './projectPlanFiles';

/**
 * Tracks whether the user has submitted a "Create with Copilot" prompt but the
 * resulting plan file hasn't been written yet. Used to keep the Azure Project
 * tree view visible so the UI doesn't snap back to the "Create New Project" welcome content.
 * Resets when a plan file appears or when VS Code restarts (intentionally in-memory only).
 *
 * Also tracks the pending stage so that when the user starts a later stage
 * (e.g. deployment) via the chat agent, the tree can reflect progress before the
 * plan file is written.
 */
class ProjectSubmissionState {
    private _isPending = false;
    private _pendingStage: ProjectStage = 0;
    private readonly _emitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this._emitter.event;

    get isPending(): boolean {
        return this._isPending;
    }

    get pendingStage(): ProjectStage {
        return this._pendingStage;
    }

    setPending(stage?: ProjectStage): void {
        const newStage = stage ?? 0;
        if (this._isPending && this._pendingStage === newStage) {
            return;
        }
        this._isPending = true;
        this._pendingStage = newStage;
        void vscode.commands.executeCommand('setContext', hasPendingProjectSubmissionContextKey, true);
        this._emitter.fire();
    }

    reset(): void {
        if (!this._isPending) {
            return;
        }
        this._isPending = false;
        this._pendingStage = 0;
        void vscode.commands.executeCommand('setContext', hasPendingProjectSubmissionContextKey, false);
        this._emitter.fire();
    }
}

export const projectSubmissionState = new ProjectSubmissionState();
