/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { listReportFiles, openReportContent, openReportFile, renderReportMarkdown } from "./workflowDiagnostics";
import { completeSession, getActiveDiagnosticsRecord, getActiveDiagnosticsReport } from "./workflowTelemetry";

interface DiagnosticsQuickPickItem extends vscode.QuickPickItem {
    itemKind: 'active' | 'file';
    uri?: vscode.Uri;
}

interface ActiveRunActionItem extends vscode.QuickPickItem {
    action: 'view' | 'finish';
}

/**
 * Command handler: shows a diagnostics/performance report for a create-project
 * run. Offers the in-progress run (if any) plus the most recent report files,
 * and opens the chosen one as a Markdown preview.
 */
export async function showProjectDiagnostics(context: IActionContext): Promise<void> {
    context.errorHandling.suppressReportIssue = true;

    const active = getActiveDiagnosticsRecord();
    const files = await listReportFiles();

    if (!active && files.length === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No Azure project create runs have been recorded yet.'));
        return;
    }

    const items: DiagnosticsQuickPickItem[] = [];
    if (active) {
        items.push({
            itemKind: 'active',
            label: vscode.l10n.t('$(sync~spin) Current run (in progress)'),
            description: active.stoppedAtPhase ? vscode.l10n.t('phase: {0}', active.stoppedAtPhase) : undefined,
        });
    }
    for (const uri of files) {
        const name = uri.path.split('/').pop() ?? uri.path;
        items.push({
            itemKind: 'file',
            uri,
            label: `$(file) ${name}`,
        });
    }

    // Single option and no in-progress run: open it directly.
    if (items.length === 1 && items[0].itemKind === 'file' && items[0].uri) {
        await openReportFile(items[0].uri);
        return;
    }

    const picked = await context.ui.showQuickPick(items, {
        placeHolder: vscode.l10n.t('Select a project create run to view its diagnostics report'),
        suppressPersistence: true,
    });

    if (picked.itemKind === 'active') {
        await handleActiveRun(context);
    } else if (picked.uri) {
        await openReportFile(picked.uri);
    }
}

/**
 * Lets the user either view an ephemeral snapshot of the in-progress run, or
 * explicitly finish it (writing a persisted report) when they consider it done.
 */
async function handleActiveRun(context: IActionContext): Promise<void> {
    const actions: ActiveRunActionItem[] = [
        { action: 'view', label: vscode.l10n.t('$(eye) View current snapshot') },
        { action: 'finish', label: vscode.l10n.t('$(check) Mark run finished and save report') },
    ];
    const choice = await context.ui.showQuickPick(actions, {
        placeHolder: vscode.l10n.t('This run is still in progress. What would you like to do?'),
        suppressPersistence: true,
    });

    if (choice.action === 'view') {
        const record = await getActiveDiagnosticsReport();
        if (!record) {
            void vscode.window.showInformationMessage(vscode.l10n.t('The run has finished. Open its saved report from the list instead.'));
            return;
        }
        await openReportContent(renderReportMarkdown(record));
        return;
    }

    // Finalize the run now and open the report file that gets written.
    await completeSession('completed');
    const files = await listReportFiles();
    if (files.length > 0) {
        await openReportFile(files[0]);
    } else {
        void vscode.window.showInformationMessage(vscode.l10n.t('No workspace folder is open, so the report could not be saved to a file.'));
    }
}
