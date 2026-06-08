/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";

/**
 * Minimal structural shape shared by every Copilot-on-Rails webview controller.
 * Controllers extend `WebviewController` from `@microsoft/vscode-azext-webview`,
 * which provides both members.
 */
export interface RevealableWebview {
    readonly panel: vscode.WebviewPanel;
    revealToForeground(viewColumn?: vscode.ViewColumn): void;
}

/** Read a workspace file as a UTF-8 string. */
export async function readFileText(uri: vscode.Uri): Promise<string> {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
}

/** Build the standard `parseError` payload used by the plan/requirements views. */
export function buildParseError(message: string, sourceFileUri: vscode.Uri | undefined): { message: string; fileLabel?: string } {
    return {
        message,
        fileLabel: sourceFileUri ? vscode.workspace.asRelativePath(sourceFileUri) : undefined,
    };
}

/**
 * Open the plan/requirements source file in an editor, or warn the user when
 * the location isn't known. Shared by every webview controller's "open file"
 * affordance.
 */
export function openSourceFileOrWarn(sourceFileUri: vscode.Uri | undefined): void {
    if (!sourceFileUri) {
        void vscode.window.showWarningMessage(
            vscode.l10n.t('The plan file location is unknown. Locate it manually in the workspace.'),
        );
        return;
    }
    void vscode.commands.executeCommand('vscode.open', sourceFileUri);
}

/**
 * Watch a single file (not a glob) and invoke `reload` whenever it is created or
 * changed on disk. Returns the watcher disposable.
 */
export function watchSingleFile(uri: vscode.Uri, reload: () => void): vscode.Disposable {
    const pattern = new vscode.RelativePattern(vscode.Uri.file(path.dirname(uri.fsPath)), path.basename(uri.fsPath));
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(reload);
    watcher.onDidCreate(reload);
    return watcher;
}

/**
 * Find files matching `glob` in the workspace and resolve to a single selection:
 * - no matches → show `noFilesMessage`, resolve `undefined`
 * - one match → resolve it
 * - many matches → prompt with a quick pick (resolve `undefined` if dismissed)
 */
export async function pickWorkspaceFile(glob: string, noFilesMessage: string, placeHolder: string): Promise<vscode.Uri | undefined> {
    const files = await vscode.workspace.findFiles(glob, '**/node_modules/**', 10);
    if (files.length === 0) {
        void vscode.window.showInformationMessage(noFilesMessage);
        return undefined;
    }
    if (files.length === 1) {
        return files[0];
    }
    const picked = await vscode.window.showQuickPick(
        files.map((f) => ({ label: vscode.workspace.asRelativePath(f), uri: f })),
        { placeHolder },
    );
    return picked?.uri;
}

/**
 * Manages the lifecycle of a single, reusable webview controller plus the file
 * watcher that keeps it in sync with disk. Every Copilot-on-Rails "open plan
 * view" module shares this skeleton: create-or-update a singleton controller,
 * reveal it, and tear down the watcher when the panel is disposed.
 */
export class SingletonViewHost<TData, TController extends RevealableWebview> {
    private controller: TController | undefined;
    private watcher: vscode.Disposable | undefined;

    constructor(
        private readonly options: {
            readonly createController: (data: TData, sourceFileUri: vscode.Uri | undefined) => TController;
            readonly updateController: (controller: TController, data: TData, sourceFileUri: vscode.Uri | undefined) => void;
        },
    ) { }

    get isOpen(): boolean {
        return this.controller !== undefined;
    }

    /** Create the controller if needed (or update the existing one), then bring it to the foreground. */
    show(data: TData, sourceFileUri: vscode.Uri | undefined): void {
        if (this.controller) {
            this.options.updateController(this.controller, data, sourceFileUri);
            this.controller.revealToForeground(vscode.ViewColumn.Active);
            return;
        }

        const controller = this.options.createController(data, sourceFileUri);
        this.controller = controller;
        controller.revealToForeground(vscode.ViewColumn.Active);
        controller.panel.onDidDispose(() => {
            this.controller = undefined;
            this.watcher?.dispose();
            this.watcher = undefined;
        });
    }

    /** Replace the file watcher tied to the current controller. */
    setWatcher(watcher: vscode.Disposable): void {
        this.watcher?.dispose();
        this.watcher = watcher;
    }
}
