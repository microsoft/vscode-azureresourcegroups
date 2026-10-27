/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { openUrl } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { DiagnosticsMetadata, getDiagnosticsMetadata } from '../../utils/copilotOnRails/diagnosticUtils';

const newIssueUrl: string = 'https://github.com/microsoft/vscode-azureresourcegroups/issues/new';

/**
 * Prefilled into the issue body so the form explains what to do instead of opening empty.
 */
const clipboardNotice: string = '<!-- Paste the Copilot on Rails diagnostics copied to your clipboard here, replacing this comment. Please review and redact anything sensitive before submitting. -->';

/**
 * Copies a Copilot on Rails diagnostics issue template (originating prompt, created-at stamp, and
 * recorded events) to the clipboard, then opens GitHub's new issue form so the user can paste it in.
 *
 * The diagnostics deliberately travel via the clipboard rather than the URL: they routinely exceed
 * the length GitHub accepts in a prefilled `body` query parameter. Nothing is submitted here - the
 * user pastes, reviews, redacts, and submits the issue themselves on GitHub.
 */
export async function reportIssue(): Promise<void> {
    const metadata: DiagnosticsMetadata = getDiagnosticsMetadata();
    if (!metadata.prompt && !metadata.createdAt && metadata.diagnosticEvents.length === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No Copilot on Rails diagnostics have been recorded for this workspace yet.'));
        return;
    }

    await vscode.env.clipboard.writeText(buildIssueTemplate(metadata));
    void vscode.window.showInformationMessage(vscode.l10n.t('Copilot on Rails diagnostics were copied to your clipboard. Paste them into the GitHub issue, then review and redact anything sensitive before submitting.'));

    await openUrl(`${newIssueUrl}?${new URLSearchParams({ body: clipboardNotice }).toString()}`);
}

/**
 * Builds the Markdown issue template that pre-populates a diagnostics report. Kept pure so it
 * can be unit-tested and reused independently of the surface that invokes it.
 */
export function buildIssueTemplate(metadata: DiagnosticsMetadata): string {
    const diagnosticsJson: string = JSON.stringify(metadata, null, 4);

    return [
        '<!--',
        '  Please review and redact anything sensitive before submitting. Nothing has been submitted yet.',
        '-->',
        '',
        '### Describe the issue',
        '',
        '<!-- A clear and concise description of what went wrong. -->',
        '',
        '### Expected behavior',
        '',
        '<!-- What you expected to happen. -->',
        '',
        '### Actual behavior',
        '',
        '<!-- What actually happened instead. -->',
        '',
        '### Steps to reproduce',
        '',
        '1. ',
        '2. ',
        '3. ',
        '',
        '### Diagnostics',
        '',
        '<!-- Auto-generated from your workspace. Review and edit this section before submitting, removing any personally identifiable information (PII) or other sensitive data. -->',
        '',
        '<details>',
        '<summary>Diagnostics data</summary>',
        '',
        '```json',
        diagnosticsJson,
        '```',
        '',
        '</details>',
        '',
    ].join('\n');
}
