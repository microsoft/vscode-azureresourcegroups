/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as path from "path";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ensureAgentInstructions } from "../../../../commands/copilotOnRails/agentInstructions";
import { ext } from "../../../../extensionVariables";
import { type PlanData, type PreviewPage } from "../../views/utils/parseScaffoldPlanMarkdown";
import { AUTOPILOT_QUERY_MARKER, enableAutopilot } from "../autopilot";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { openLoadingView } from "../openLoadingView";
import { PREVIEW_FOLDER_RELATIVE_PATH, readPreviewPages, type PreviewPagesResult } from "../utils/previewPagesReader";
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

        this.panel.webview.onDidReceiveMessage((message: { command: string; data?: PlanData; prompt?: string; autopilot?: boolean }) => {
            switch (message.command) {
                case 'ready':
                    void this.panel.webview.postMessage({ command: 'setPlanData', data: planData });
                    void this.postPreviewPages();
                    break;
                case 'approvePlan':
                    void this.approveAndOpenScaffoldChat(!!message.autopilot);
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

    private async approveAndOpenScaffoldChat(autopilot: boolean): Promise<void> {
        // Autopilot is chosen on the plan page. Approving with it on requires an
        // explicit modal confirmation because it enables global auto-approval of
        // chat tool actions for the rest of the run.
        let confirmedAutopilot = false;
        if (autopilot) {
            confirmedAutopilot = await callWithTelemetryAndErrorHandling('azureResourceGroups.autopilot.confirm', async (context: IActionContext) => {
                context.errorHandling.suppressDisplay = true;
                await context.ui.showWarningMessage(
                    vscode.l10n.t('Approve this plan and run the rest in Autopilot mode?'),
                    {
                        modal: true,
                        detail: vscode.l10n.t('Autopilot scaffolds and sets up local debugging without stopping for further approvals. While it runs, all chat tool actions (including file edits and terminal commands) are auto-approved globally. You can turn this off any time from the status bar.'),
                    },
                    { title: vscode.l10n.t('Enable Autopilot') },
                );
                return true;
            }) ?? false;
            // Cancelling the modal aborts approval entirely so the user can decide
            // again (rather than silently falling back to a guided approval).
            if (!confirmedAutopilot) {
                return;
            }
        }

        if (!(await ensureAgentInstructions('azure-project-scaffold'))) {
            return;
        }

        if (confirmedAutopilot) {
            await this.recordAutopilotMode();
            await enableAutopilot(ext.context);
        }

        const baseQuery = vscode.l10n.t('I approve the plan.');
        await vscode.commands.executeCommand('workbench.action.chat.newChat');
        await vscode.commands.executeCommand('workbench.action.chat.open', {
            mode: 'azure-project-scaffold',
            query: confirmedAutopilot ? `${AUTOPILOT_QUERY_MARKER} ${baseQuery}` : baseQuery,
        });
        this.panel.dispose();
        openLoadingView({
            stage: 0,
            title: vscode.l10n.t('Scaffolding your project…'),
            message: vscode.l10n.t('Copilot is creating your project files. For progress please view the Copilot chat.'),
        });
    }

    /**
     * Records autopilot mode in the plan file for downstream agents to reference.
     * No-op if the source file is unknown or autopilot is already recorded.
     */
    private async recordAutopilotMode(): Promise<void> {
        if (!this.sourceFileUri) {
            return;
        }
        try {
            const raw = Buffer.from(await vscode.workspace.fs.readFile(this.sourceFileUri)).toString('utf-8');
            if (/execution\s*mode\s*[:=]\s*auto/i.test(raw)) {
                return;
            }
            const lines = raw.split('\n');
            const row = '**Execution Mode**: auto';
            // If an row already exists (e.g. with a `guided` value),
            // update it in place rather than inserting a duplicate/conflicting row.
            const existingAt = lines.findIndex(l => /^\*\*Execution\s*Mode\*\*\s*[:=]/i.test(l.trim()));
            if (existingAt >= 0) {
                lines[existingAt] = row;
                await vscode.workspace.fs.writeFile(this.sourceFileUri, Buffer.from(lines.join('\n'), 'utf-8'));
                return;
            }
            // Insert the metadata row next to the existing **Mode**/**Status**
            // header lines; otherwise after the first heading; otherwise at the top.
            let insertAt = lines.findIndex(l => /^\*\*Mode\*\*\s*:/i.test(l.trim()));
            if (insertAt < 0) {
                insertAt = lines.findIndex(l => /^\*\*Status\*\*\s*:/i.test(l.trim()));
            }
            if (insertAt < 0) {
                insertAt = lines.findIndex(l => l.trim().startsWith('# '));
            }
            if (insertAt < 0) {
                lines.unshift(row, '');
            } else {
                lines.splice(insertAt + 1, 0, row);
            }
            await vscode.workspace.fs.writeFile(this.sourceFileUri, Buffer.from(lines.join('\n'), 'utf-8'));
        } catch {
            // Best-effort: if we can't persist the marker, the chat query marker
            // still carries autopilot into the scaffold agent.
        }
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
            const result: PreviewPagesResult = await readPreviewPages(folder);
            const summary = result.pages.length === 0
                ? 'no pages (manifest missing or empty)'
                : result.pages.map((p: PreviewPage) => `${p.slug}=${p.status}${p.html ? `(${p.html.length}b)` : ''}`).join(', ');
            ext.outputChannel.appendLog(`[ScaffoldPlanView] preview folder ${folder.fsPath} → ${summary} (previewStatus=${result.previewStatus ?? 'undefined'})`);
            void this.panel.webview.postMessage({ command: 'setPreviewPages', pages: result.pages, previewStatus: result.previewStatus });
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
