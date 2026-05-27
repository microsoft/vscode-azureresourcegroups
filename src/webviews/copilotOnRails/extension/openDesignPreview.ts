/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";
import { parseScaffoldPlanMarkdown } from "../views/utils/parseScaffoldPlanMarkdown";
import { generateDesignPreviewHtml } from "./generateDesignPreviewHtml";

let currentPreviewPanel: vscode.WebviewPanel | undefined;

export async function openDesignPreviewForPlan(planUri: vscode.Uri): Promise<void> {
    let content: string;
    try {
        content = Buffer.from(await vscode.workspace.fs.readFile(planUri)).toString('utf-8');
    } catch (err) {
        void vscode.window.showErrorMessage(
            vscode.l10n.t("Couldn't read the plan file at {0}: {1}", vscode.workspace.asRelativePath(planUri), err instanceof Error ? err.message : String(err)),
        );
        return;
    }

    const plan = parseScaffoldPlanMarkdown(content);
    const html = generateDesignPreviewHtml(plan);
    if (!html) {
        void vscode.window.showInformationMessage(
            vscode.l10n.t("This plan has no Design System section to preview. Add Section 5 (Design System & UI) with a component library and pages, then try again."),
        );
        return;
    }

    const previewDir = vscode.Uri.file(path.join(path.dirname(planUri.fsPath), 'preview'));
    const previewFile = vscode.Uri.joinPath(previewDir, 'index.html');
    try {
        await vscode.workspace.fs.createDirectory(previewDir);
        await vscode.workspace.fs.writeFile(previewFile, Buffer.from(html, 'utf-8'));
    } catch (err) {
        // Non-fatal — the webview can still render even if the on-disk file
        // can't be written (e.g. read-only workspace).
        void vscode.window.showWarningMessage(
            vscode.l10n.t("Couldn't write preview to disk ({0}); showing in-memory preview only.", err instanceof Error ? err.message : String(err)),
        );
    }

    if (currentPreviewPanel) {
        currentPreviewPanel.webview.html = html;
        currentPreviewPanel.reveal(vscode.ViewColumn.Beside, true);
        return;
    }

    currentPreviewPanel = vscode.window.createWebviewPanel(
        'azureResourceGroups.designPreview',
        vscode.l10n.t('Design Preview'),
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true },
    );
    currentPreviewPanel.webview.html = html;
    currentPreviewPanel.onDidDispose(() => {
        currentPreviewPanel = undefined;
    });
}
