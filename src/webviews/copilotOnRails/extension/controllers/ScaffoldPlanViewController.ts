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
                    void this.postPreviewUri();
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
        void this.postPreviewUri();
        void this.panel.webview.postMessage({ command: 'revisionComplete' });
    }

    /**
     * The base controller's CSP omits `frame-src`. Relying on the `default-src`
     * fallback to govern frames is unreliable in the webview runtime, which can
     * leave the embedded preview iframe blank (a white box) regardless of its
     * content. Add an explicit `frame-src` so the iframe pointed at the
     * `.azure/frontend-preview/` webview-resource URIs is allowed to render.
     * `${cspSource}` covers `asWebviewUri(...)` output.
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

    /** Folder that holds the multi-page static preview (`.azure/frontend-preview/`). */
    private previewFolderUri(): vscode.Uri | undefined {
        const folder = this.workspaceFolderUri();
        return folder ? vscode.Uri.joinPath(folder, '.azure', 'frontend-preview') : undefined;
    }

    /**
     * Allow the webview to load files from `.azure/frontend-preview/` so the
     * iframe can point at real resource URIs. The base controller only grants
     * the extension + bundle dirs; without adding the preview folder the iframe
     * `src` would be blocked and render blank. Scoped to just this folder so no
     * other workspace files are exposed.
     */
    private ensurePreviewResourceRoot(): void {
        const previewRoot = this.previewFolderUri();
        if (!previewRoot) {
            return;
        }
        const existing = this.panel.webview.options.localResourceRoots ?? [];
        if (existing.some(r => r.toString() === previewRoot.toString())) {
            return;
        }
        this.panel.webview.options = {
            ...this.panel.webview.options,
            localResourceRoots: [...existing, previewRoot],
        };
    }

    /**
     * Watch `.azure/frontend-preview/` so the embedded iframe refreshes the
     * moment the agent finishes writing (or rewrites) any preview page. Without
     * this, a webview opened before the files exist shows an empty preview and
     * never updates until the next plan revision.
     */
    private watchFrontendPreview(): void {
        const folder = this.workspaceFolderUri();
        if (!folder) {
            return;
        }
        this.ensurePreviewResourceRoot();
        this.previewWatcher?.dispose();
        const pattern = new vscode.RelativePattern(folder, '.azure/frontend-preview/**');
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        const refresh = () => void this.postPreviewUri();
        watcher.onDidCreate(refresh);
        watcher.onDidChange(refresh);
        watcher.onDidDelete(refresh);
        this.previewWatcher = watcher;
    }

    /**
     * Resolve `.azure/frontend-preview/index.html` to a webview-resource URI and
     * hand it to the webview, which loads it as the iframe `src`. Serving the
     * folder as real resource URIs (rather than injecting `srcdoc`) lets the
     * preview be a set of cross-linked pages the user can navigate. A cache-bust
     * query forces the iframe to reload whenever the files change. Posts
     * `undefined` when no preview has been generated yet.
     */
    private async postPreviewUri(): Promise<void> {
        let uri: string | undefined;
        const previewRoot = this.previewFolderUri();
        if (previewRoot) {
            this.ensurePreviewResourceRoot();
            const indexUri = vscode.Uri.joinPath(previewRoot, 'index.html');
            try {
                await vscode.workspace.fs.stat(indexUri);
                uri = this.panel.webview.asWebviewUri(indexUri).with({ query: `t=${Date.now()}` }).toString();
            } catch {
                uri = undefined;
            }
        }
        void this.panel.webview.postMessage({ command: 'setPreviewUri', uri });
    }
}
