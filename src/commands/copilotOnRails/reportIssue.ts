/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, openUrl } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { DiagnosticsMetadata, getDiagnosticsMetadata } from '../../utils/copilotOnRails/diagnosticUtils';

const newIssueUrl: string = 'https://github.com/microsoft/vscode-azureresourcegroups/issues/new';

/**
 * Invisible marker embedded in a drafted diagnostics issue so the {@link DiagnosticsIssueCodeLensProvider}
 * can recognize the document (even after it is saved and its untitled URI changes) and pin its
 * "submit" CodeLens to it.
 */
const diagnosticsIssueMarker: string = '<!-- azureResourceGroups.reportIssueWithDiagnostics -->';

/**
 * Document selector for the drafted diagnostics issue's CodeLens - Markdown, whether the draft is
 * still untitled or has been saved to disk.
 */
export const diagnosticsIssueDocumentSelector: vscode.DocumentSelector = [
    { language: 'markdown', scheme: 'untitled' },
    { language: 'markdown', scheme: 'file' },
];

/**
 * Drafts a GitHub issue pre-populated with the workspace-cached Copilot on Rails diagnostics
 * (originating prompt, created-at stamp, and recorded events) wrapped in an issue template.
 *
 * This intentionally does NOT publish anything. It opens the draft in an editable Markdown
 * document so the user can review, redact, and edit the diagnostics first. A CodeLens pinned to
 * the top of the draft is the only way to proceed to GitHub, and it warns before doing so.
 */
export async function createDraftIssue(_context: IActionContext): Promise<void> {
    const metadata: DiagnosticsMetadata = getDiagnosticsMetadata();
    if (!metadata.prompt && !metadata.createdAt && metadata.diagnosticEvents.length === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No Copilot on Rails diagnostics have been recorded for this workspace yet.'));
        return;
    }

    const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: buildIssueTemplate(metadata),
    });
    await vscode.window.showTextDocument(document);
}

/**
 * Backs the draft's "Open GitHub issue to submit" CodeLens. Kept separate from
 * {@link createDraftIssue} (which only drafts) so the potentially-publishing step is
 * gated behind its own explicit, confirmed action. Warns before opening GitHub.
 */
export async function reviewAndSubmitIssue(context: IActionContext): Promise<void> {
    context.telemetry.properties.isCopilotEvent = 'true';

    const proceed: vscode.MessageItem = { title: vscode.l10n.t('Open GitHub') };
    const selection = await vscode.window.showWarningMessage(
        vscode.l10n.t('This opens GitHub so you can submit a new public issue with the diagnostics you drafted. Make sure you have reviewed and redacted anything sensitive first - once submitted, the issue is public.'),
        { modal: true },
        proceed,
    );
    if (selection === proceed) {
        await openUrl(newIssueUrl);
    }
}

/**
 * Renders a single, clearly-labeled CodeLens ("button") at the top of a drafted diagnostics issue
 * so submitting stays visible and doesn't rely on a transient notification.
 */
export class DiagnosticsIssueCodeLensProvider implements vscode.CodeLensProvider {
    constructor(private readonly openIssueCommandId: string) { }

    public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!document.getText().includes(diagnosticsIssueMarker)) {
            return [];
        }

        const topOfDocument: vscode.Range = new vscode.Range(0, 0, 0, 0);
        return [
            new vscode.CodeLens(topOfDocument, {
                title: vscode.l10n.t('$(github) Open GitHub issue to submit…'),
                tooltip: vscode.l10n.t('Review the draft below, then open GitHub to submit it as a new public issue.'),
                command: this.openIssueCommandId,
            }),
        ];
    }
}

/**
 * Builds the Markdown issue template that pre-populates a diagnostics report. Kept pure so it
 * can be unit-tested and reused independently of the editor/webview surface that invokes it.
 */
export function buildIssueTemplate(metadata: DiagnosticsMetadata): string {
    const diagnosticsJson: string = JSON.stringify(metadata, null, 4);

    return [
        diagnosticsIssueMarker,
        '<!--',
        '  This issue draft was pre-populated with Copilot on Rails diagnostics.',
        '  Please review and redact anything sensitive before submitting. Nothing has been submitted yet.',
        '  Use the "Open GitHub issue to submit" button at the top of this file when you are ready.',
        '-->',
        '',
        '### Describe the issue',
        '',
        '<!-- A clear and concise description of what went wrong. -->',
        '',
        '### Expected behavior',
        '',
        '<!-- Optional: What you expected to happen. -->',
        '',
        '### Steps to reproduce',
        '',
        '1. ',
        '2. ',
        '3. ',
        '',
        '### Diagnostics',
        '',
        '<!-- Auto-generated from your workspace. Review and edit before submitting. -->',
        '',
        '```json',
        diagnosticsJson,
        '```',
        '',
    ].join('\n');
}
