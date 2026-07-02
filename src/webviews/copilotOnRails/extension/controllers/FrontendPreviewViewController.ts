/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ensureAgentInstructions } from "../../../../commands/copilotOnRails/agentInstructions";
import { ext } from "../../../../extensionVariables";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { isFrontendApproved, readPlanStatus } from "../flowState";
import { PROJECT_PLAN_GLOB } from "../planFilePaths";
import { type RunningDevServer, startDevServer } from "../utils/devServerManager";
import { trackFlowView } from "../utils/singletonViewHost";

/** State pushed to the webview to drive the preview surface. */
type PreviewState =
    | { status: 'starting' }
    | { status: 'ready'; url: string; folderLabel: string }
    | { status: 'error'; error: string };

/** Messages received from the webview. */
interface IncomingMessage {
    command: 'ready' | 'approveUi' | 'submitUiFeedback' | 'retry' | 'openExternal';
    prompt?: string;
}

/**
 * Webview that previews the scaffolded frontend (a real running dev server,
 * served through an iframe) and gates the hand-off to the integrate agent
 * behind an explicit "Approve UI" action — mirroring the plan view's approval
 * UX. Feedback is forwarded to the scaffold agent as a chat prompt; the dev
 * server keeps running so the agent's edits hot-reload in the iframe.
 */
export class FrontendPreviewViewController extends WebviewController<Record<string, never>> {
    private devServer: RunningDevServer | undefined;
    private state: PreviewState = { status: 'starting' };

    constructor(private readonly frontendFolder: vscode.Uri) {
        super(
            ext.context,
            vscode.l10n.t('Frontend Preview'),
            'frontendPreviewView',
            {},
            ViewColumn.Active,
            undefined,
            getCopilotOnRailsBundleLocation(),
        );

        this.panel.onDidDispose(() => {
            this.devServer?.dispose();
            this.devServer = undefined;
        });

        // Register as an active flow view so the progress tree treats project
        // creation as active again while the preview is open (hiding the stage's
        // "Resume" action) and re-offers Resume once the preview is closed.
        trackFlowView(this.panel);

        this.panel.webview.onDidReceiveMessage((message: IncomingMessage) => {
            switch (message.command) {
                case 'ready':
                    this.postState();
                    void this.postApprovedState();
                    return;
                case 'approveUi':
                    void this.approveAndHandOff();
                    return;
                case 'submitUiFeedback':
                    this.submitFeedback(message.prompt);
                    return;
                case 'retry':
                    void this.launchDevServer();
                    return;
                case 'openExternal':
                    if (this.state.status === 'ready') {
                        void vscode.env.openExternal(vscode.Uri.parse(this.state.url));
                    }
                    return;
            }
        });

        void this.launchDevServer();
    }

    /**
     * The base CSP omits `frame-src`, so the preview iframe (pointing at the
     * dev server's external URI) would be blocked. The iframe only ever targets
     * the dev server we started, so allowing http/https framing is safe and
     * avoids re-templating the page once the (possibly tunneled) origin is
     * known. Also allow scripts to run inside that framed origin.
     */
    protected override getDocumentTemplate(webview?: vscode.Webview): string {
        const template = super.getDocumentTemplate(webview);
        return template.replace(
            /(default-src\s+[^;]+;)/,
            `$1 frame-src http: https:;`,
        );
    }

    private async launchDevServer(): Promise<void> {
        this.devServer?.dispose();
        this.devServer = undefined;
        this.state = { status: 'starting' };
        this.postState();

        try {
            const running = await startDevServer(this.frontendFolder.fsPath);
            this.devServer = running;
            // Resolve a URL usable from the webview host (handles remote /
            // Codespaces port forwarding; a no-op on the desktop).
            const externalUri = await vscode.env.asExternalUri(vscode.Uri.parse(running.url));
            this.state = {
                status: 'ready',
                url: externalUri.toString(),
                folderLabel: vscode.workspace.asRelativePath(this.frontendFolder),
            };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            ext.outputChannel.appendLog(`[FrontendPreview] failed to start dev server: ${error}`);
            this.state = { status: 'error', error };
        }
        this.postState();
    }

    private postState(): void {
        void this.panel.webview.postMessage({ command: 'setPreviewState', state: this.state });
    }

    /**
     * Reflect a prior UI approval persisted in the plan status, so reopening the
     * preview after approving shows the Approve button already disabled rather
     * than inviting a second approval.
     */
    private async postApprovedState(): Promise<void> {
        const status = await readPlanStatus(PROJECT_PLAN_GLOB);
        if (isFrontendApproved(status)) {
            void this.panel.webview.postMessage({ command: 'setApproved' });
        }
    }

    private submitFeedback(prompt: string | undefined): void {
        const query = prompt?.trim();
        if (!query) {
            return;
        }
        // Keep the dev server running so the scaffold agent's edits hot-reload
        // in the iframe while the user watches.
        void vscode.commands.executeCommand('workbench.action.chat.open', {
            mode: 'azure-project-scaffold',
            query,
        });
        void this.panel.webview.postMessage({ command: 'feedbackSubmitted' });
    }

    private async approveAndHandOff(): Promise<void> {
        if (!(await ensureAgentInstructions('azure-project-integrate'))) {
            return;
        }
        // Stop the preview server before the integrate agent takes over so it
        // can start its own runtime without port contention.
        this.devServer?.dispose();
        this.devServer = undefined;
        this.panel.dispose();
        await vscode.commands.executeCommand('azureResourceGroups.startProjectIntegrate');
    }
}
