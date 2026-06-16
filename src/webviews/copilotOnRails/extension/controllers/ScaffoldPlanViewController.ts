/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as path from "path";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ensureAgentInstructions } from "../../../../commands/copilotOnRails/agentInstructions";
import { ext } from "../../../../extensionVariables";
import { type PlanData, type PreviewPage } from "../../views/utils/parseScaffoldPlanMarkdown";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { PREVIEW_FOLDER_RELATIVE_PATH, readPreviewPages } from "../utils/previewPagesReader";
import { openSourceFileOrWarn } from "../utils/singletonViewHost";

export class ScaffoldPlanViewController extends WebviewController<Record<string, never>> {
    private sourceFileUri: vscode.Uri | undefined;
    private previewFolderUri: vscode.Uri | undefined;
    private previewWatcher: vscode.Disposable | undefined;

    constructor(planData: PlanData, sourceFileUri?: vscode.Uri) {
        super(ext.context, 'Project Plan', 'scaffoldPlanView', {}, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.sourceFileUri = sourceFileUri;
        this.previewFolderUri = resolvePreviewFolderUri(sourceFileUri);
        this.setupPreviewWatcher();

        this.panel.onDidDispose(() => {
            this.previewWatcher?.dispose();
            this.previewWatcher = undefined;
        });

        this.panel.webview.onDidReceiveMessage((message: { command: string; data?: PlanData; prompt?: string }) => {
            switch (message.command) {
                case 'ready':
                    void this.panel.webview.postMessage({ command: 'setPlanData', data: planData });
                    void this.postPreviewPages();
                    break;
                case 'approvePlan':
                    void this.approveAndOpenScaffoldChat();
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

    private async approveAndOpenScaffoldChat(): Promise<void> {
        if (!(await ensureAgentInstructions('azure-project-scaffold'))) {
            return;
        }
        // Fresh chat session per phase hand-off — the scaffold agent reads the approved
        // plan from disk, so a clean context keeps its window focused on scaffolding.
        await vscode.commands.executeCommand('workbench.action.chat.newChat');
        await vscode.commands.executeCommand('workbench.action.chat.open', {
            mode: 'azure-project-scaffold',
            query: 'I approve the plan.',
        });
        this.panel.dispose();
    }

    updatePlanData(planData: PlanData, sourceFileUri?: vscode.Uri): void {
        if (sourceFileUri) {
            this.sourceFileUri = sourceFileUri;
            const nextPreviewFolder = resolvePreviewFolderUri(sourceFileUri);
            if (nextPreviewFolder?.fsPath !== this.previewFolderUri?.fsPath) {
                this.previewFolderUri = nextPreviewFolder;
                this.setupPreviewWatcher();
                void this.postPreviewPages();
            }
        }
        void this.panel.webview.postMessage({ command: 'setPlanData', data: planData });
        void this.panel.webview.postMessage({ command: 'revisionComplete' });
    }

    /**
     * The base controller's CSP omits `frame-src`, which means iframes (used by
     * `UiPreviewCard` to render the planner's HTML/CSS mock-up via `srcDoc`)
     * fall back to `default-src ${cspSource}` and get blocked silently — the
     * preview area would render nothing at all. Inject `frame-src 'self'` so
     * the `about:srcdoc`-loaded iframe is allowed.
     */
    protected override getDocumentTemplate(webview?: vscode.Webview): string {
        const template = super.getDocumentTemplate(webview);
        return template.replace(
            /(default-src\s+[^;]+;)/,
            `$1 frame-src 'self' data:;`,
        );
    }

    private setupPreviewWatcher(): void {
        this.previewWatcher?.dispose();
        this.previewWatcher = undefined;

        if (!this.previewFolderUri) {
            return;
        }

        // Watch every file under the preview folder. The watcher fires on create,
        // change, and delete — any one of them triggers a fresh manifest + HTML
        // read and a `setPreviewPages` post.
        const pattern = new vscode.RelativePattern(this.previewFolderUri, '**/*');
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        const refresh = (): void => { void this.postPreviewPages(); };
        watcher.onDidCreate(refresh);
        watcher.onDidChange(refresh);
        watcher.onDidDelete(refresh);
        this.previewWatcher = watcher;
    }

    private async postPreviewPages(): Promise<void> {
        const folder = this.previewFolderUri;
        if (!folder) {
            ext.outputChannel.appendLog(`[ScaffoldPlanView] preview folder unresolved (no sourceFileUri)`);
            void this.panel.webview.postMessage({ command: 'setPreviewPages', pages: [] });
            return;
        }
        try {
            const pages: PreviewPage[] = await readPreviewPages(folder);
            const summary = pages.length === 0
                ? 'no pages (manifest missing or empty)'
                : pages.map((p: PreviewPage) => `${p.slug}=${p.status}${p.html ? `(${p.html.length}b)` : ''}`).join(', ');
            ext.outputChannel.appendLog(`[ScaffoldPlanView] preview folder ${folder.fsPath} → ${summary}`);
            void this.panel.webview.postMessage({ command: 'setPreviewPages', pages });
        } catch (err) {
            ext.outputChannel.appendLog(`[ScaffoldPlanView] preview read failed for ${folder.fsPath}: ${err instanceof Error ? err.message : String(err)}`);
            void this.panel.webview.postMessage({ command: 'setPreviewPages', pages: [] });
        }
    }
}

/**
 * Resolve `<workspace>/.azure/.preview-temp` from the plan-markdown URI. The
 * plan always lives at `<workspace>/.azure/project-plan.md`, so the workspace
 * folder is two `..` up from the file.
 */
function resolvePreviewFolderUri(sourceFileUri: vscode.Uri | undefined): vscode.Uri | undefined {
    if (!sourceFileUri) {
        return undefined;
    }
    const workspaceFsPath = path.dirname(path.dirname(sourceFileUri.fsPath));
    return vscode.Uri.file(path.join(workspaceFsPath, PREVIEW_FOLDER_RELATIVE_PATH));
}
