/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as path from "path";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ext } from "../../../../extensionVariables";
import { type PlanContent, type PlanData } from "../../views/utils/parseScaffoldPlanMarkdown";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { generateDesignPreviewHtml, paletteSlug, rewritePaletteInPlanMarkdown } from "../generateDesignPreviewHtml";

interface PaletteOverride {
    slug: string;
    hex: string;
}

export class ScaffoldPlanViewController extends WebviewController<Record<string, never>> {
    private sourceFileUri: vscode.Uri | undefined;
    private planData: PlanData;

    constructor(planData: PlanData, sourceFileUri?: vscode.Uri) {
        super(ext.context, 'Project Plan', 'scaffoldPlanView', {}, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.sourceFileUri = sourceFileUri;
        this.planData = planData;

        this.panel.webview.onDidReceiveMessage((message: { command: string; data?: PlanData; prompt?: string; palette?: PaletteOverride[] }) => {
            switch (message.command) {
                case 'ready':
                    void this.panel.webview.postMessage({ command: 'setPlanData', data: this.planData });
                    break;
                case 'approvePlan':
                    void vscode.commands.executeCommand('azureProjectCreation.completeStep', 'projectCreation/plan/definePlan');
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
                case 'paletteChanged':
                    if (message.palette) {
                        void this.persistPaletteOverrides(message.palette);
                    }
                    break;
                case 'openSourceFile':
                    this.openSourceFile();
                    break;
            }
        });
    }

    updatePlanData(planData: PlanData, sourceFileUri?: vscode.Uri): void {
        if (sourceFileUri) {
            this.sourceFileUri = sourceFileUri;
        }
        this.planData = planData;
        void this.panel.webview.postMessage({ command: 'setPlanData', data: planData });
        void this.panel.webview.postMessage({ command: 'revisionComplete' });
    }

    private openSourceFile(): void {
        if (!this.sourceFileUri) {
            void vscode.window.showWarningMessage(
                vscode.l10n.t('The plan file location is unknown. Locate it manually in the workspace.'),
            );
            return;
        }
        void vscode.commands.executeCommand('vscode.open', this.sourceFileUri);
    }

    /**
     * Persist palette picks from the embedded color pickers. Writes:
     *   1. The plan markdown's Color Palette table (the source of truth, so
     *      the change survives any future plan regeneration). The plan-file
     *      watcher in openScaffoldPlanView then reloads and re-renders the
     *      embedded preview automatically.
     *   2. `<plan-dir>/preview/index.html`, but only if it already exists —
     *      we don't want to silently create files in the workspace just
     *      because someone scrubbed a swatch.
     */
    private async persistPaletteOverrides(palette: PaletteOverride[]): Promise<void> {
        if (!this.sourceFileUri || palette.length === 0) {
            return;
        }
        const overrideBySlug = new Map(palette.map(p => [p.slug, p.hex.toUpperCase()]));

        // 1. Plan markdown.
        try {
            const original = Buffer.from(await vscode.workspace.fs.readFile(this.sourceFileUri)).toString('utf-8');
            const rewritten = rewritePaletteInPlanMarkdown(original, overrideBySlug);
            if (rewritten !== original) {
                await vscode.workspace.fs.writeFile(this.sourceFileUri, Buffer.from(rewritten, 'utf-8'));
            }
        } catch (err) {
            ext.outputChannel.appendLine(
                `Failed to update plan file ${this.sourceFileUri.fsPath}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }

        // 2. Standalone preview HTML (mirror only if the file already exists).
        const previewFile = vscode.Uri.file(
            path.join(path.dirname(this.sourceFileUri.fsPath), 'preview', 'index.html'),
        );
        try {
            await vscode.workspace.fs.stat(previewFile);
        } catch {
            return;
        }

        const clonedPlan: PlanData = structuredClone(this.planData);
        const designSection = clonedPlan.sections.find(s => s.title.toLowerCase().includes('design system'));
        const paletteTable = designSection?.content.find(
            (c): c is Extract<PlanContent, { type: 'table' }> =>
                c.type === 'table'
                && c.headers.length >= 2
                && c.rows.some(r => /^#[0-9A-Fa-f]{3,8}$/.test((r[1] ?? '').trim())),
        );
        if (!paletteTable) {
            return;
        }
        for (const row of paletteTable.rows) {
            const override = overrideBySlug.get(paletteSlug((row[0] ?? '').trim()));
            if (override) {
                row[1] = override;
            }
        }

        const html = generateDesignPreviewHtml(clonedPlan);
        if (!html) {
            return;
        }
        try {
            await vscode.workspace.fs.writeFile(previewFile, Buffer.from(html, 'utf-8'));
        } catch (err) {
            ext.outputChannel.appendLine(
                `Failed to update design preview file ${previewFile.fsPath}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
