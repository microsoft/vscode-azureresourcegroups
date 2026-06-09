/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ext } from "../../../../extensionVariables";
import { type PlanData } from "../../views/utils/parseScaffoldPlanMarkdown";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { openSourceFileOrWarn } from "../utils/singletonViewHost";

export class ScaffoldPlanViewController extends WebviewController<Record<string, never>> {
    private sourceFileUri: vscode.Uri | undefined;
    private previewWatcher: vscode.FileSystemWatcher | undefined;

    constructor(planData: PlanData, sourceFileUri?: vscode.Uri) {
        super(ext.context, 'Project Plan', 'scaffoldPlanView', {}, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.sourceFileUri = sourceFileUri;
        this.watchFrontendPreview();

        this.panel.onDidDispose(() => this.previewWatcher?.dispose());

        this.panel.webview.onDidReceiveMessage((message: { command: string; data?: PlanData; prompt?: string }) => {
            switch (message.command) {
                case 'ready':
                    void this.panel.webview.postMessage({ command: 'setPlanData', data: planData });
                    void this.postPreviewHtml();
                    break;
                case 'approvePlan':
                    void vscode.commands.executeCommand('workbench.action.chat.open', {
                        mode: 'azure-project-scaffold',
                        query: 'I approve the plan.',
                    });
                    this.panel.dispose();
                    break;
                case 'submitPlanFeedback': {
                    const query = message.prompt?.trim();
                    if (!query) {
                        return;
                    }
                    void vscode.commands.executeCommand('workbench.action.chat.open', {
                        mode: 'agent',
                        query,
                    });
                    void this.panel.webview.postMessage({ command: 'revisionInProgress' });
                    break;
                }
                case 'openSourceFile':
                    openSourceFileOrWarn(this.sourceFileUri);
                    break;
            }
        });
    }

    updatePlanData(planData: PlanData, sourceFileUri?: vscode.Uri): void {
        if (sourceFileUri) {
            this.sourceFileUri = sourceFileUri;
            this.watchFrontendPreview();
        }
        void this.panel.webview.postMessage({ command: 'setPlanData', data: planData });
        void this.postPreviewHtml();
        void this.panel.webview.postMessage({ command: 'revisionComplete' });
    }

    /**
     * The base controller's CSP omits `frame-src`. Relying on the `default-src`
     * fallback to govern frames is unreliable in the webview runtime, which can
     * leave the embedded preview iframe blank (a white box) regardless of its
     * content. Add an explicit `frame-src` so the sandboxed `srcdoc` iframe in
     * the UI Preview card is allowed to render. `'self'` covers `about:srcdoc`.
     */
    protected getDocumentTemplate(webview?: vscode.Webview): string {
        const html = super.getDocumentTemplate(webview);
        const cspSource = webview?.cspSource ?? '';
        return html.replace(
            `default-src ${cspSource};`,
            `default-src ${cspSource}; frame-src ${cspSource} 'self' data:;`,
        );
    }

    /** Workspace folder that owns the plan file (and therefore the `.azure/frontend-preview/` folder). */
    private workspaceFolderUri(): vscode.Uri | undefined {
        if (this.sourceFileUri) {
            const folder = vscode.workspace.getWorkspaceFolder(this.sourceFileUri);
            if (folder) {
                return folder.uri;
            }
        }
        return vscode.workspace.workspaceFolders?.[0]?.uri;
    }

    /**
     * Watch `.azure/frontend-preview/index.html` so the embedded iframe refreshes
     * the moment the agent finishes writing (or rewrites) the preview. Without
     * this, a webview opened before the file exists shows an empty preview and
     * never updates until the next plan revision.
     */
    private watchFrontendPreview(): void {
        const folder = this.workspaceFolderUri();
        if (!folder) {
            return;
        }
        this.previewWatcher?.dispose();
        const pattern = new vscode.RelativePattern(folder, '.azure/frontend-preview/index.html');
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        const refresh = () => void this.postPreviewHtml();
        watcher.onDidCreate(refresh);
        watcher.onDidChange(refresh);
        watcher.onDidDelete(refresh);
        this.previewWatcher = watcher;
    }

    /**
     * Read the self-contained preview HTML from disk and hand the raw markup to
     * the webview, which renders it via a sandboxed `<iframe srcdoc>`. Injecting
     * the content directly (rather than pointing the iframe at a webview resource
     * URI) sidesteps `localResourceRoots` / resource-protocol issues that left
     * the preview blank. Posts `undefined` when no preview has been generated yet.
     */
    private async postPreviewHtml(): Promise<void> {
        let html: string | undefined;
        const folder = this.workspaceFolderUri();
        if (folder) {
            const fileUri = vscode.Uri.joinPath(folder, '.azure', 'frontend-preview', 'index.html');
            try {
                const bytes = await vscode.workspace.fs.readFile(fileUri);
                html = Buffer.from(bytes).toString('utf8');
            } catch {
                html = undefined;
            }
        }
        void this.panel.webview.postMessage({ command: 'setPreviewHtml', html });
    }
}
