/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import * as path from "path";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ensureAgentInstructions } from "../../../../commands/copilotOnRails/agentInstructions";
import { buildChatOpenOptions, launchAgentChat } from "../../../../commands/copilotOnRails/openChatWithAgent";
import { azureProjectScaffoldAgent } from "../../../../constants";
import { ext } from "../../../../extensionVariables";
import { CopilotOnRailsContext } from "../../../../utils/copilotOnRails/CopilotOnRailsContext";
import { callWithDiagnosticsAndTelemetryHandling, corId, setCorProp } from "../../../../utils/copilotOnRails/telemetryUtils";
import { type PreviewPage, type ScaffoldPlanData } from "../../views/utils/parseScaffoldPlanMarkdown";
import { ProjectPlanStatus } from "../../views/utils/projectPlanStatus";
import { AUTOPILOT_QUERY_MARKER, disableAutopilot, enableAutopilot, getEffectiveMaxRequests, raiseWorkspaceMaxRequests } from "../autopilot";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { openLoadingView } from "../openLoadingView";
import { suppressTrackedViewCloseOnce } from "../projectSession";
import { replaceProjectPlanStatus, writeProjectPlanStatusAtUri } from "../utils/planStatus";
import { PREVIEW_FOLDER_RELATIVE_PATH, readPreviewPages, type PreviewPagesResult } from "../utils/previewPagesReader";
import { getScaffoldPlanTelemetry, SCAFFOLD_PLAN_TELEMETRY_PREFIX } from "../utils/scaffoldPlanTelemetryUtils";
import { openSourceFileOrWarn } from "../utils/singletonViewHost";
import { CopilotOnRailsWebviewController } from "./CopilotOnRailsWebviewController";

/** Prompt to raise max requests for guided runs below this threshold. */
const MIN_RECOMMENDED_MAX_REQUESTS = 1000;

export class ScaffoldPlanViewController extends CopilotOnRailsWebviewController<Record<string, never>> {
    private sourceFileUri: vscode.Uri | undefined;
    private planData: ScaffoldPlanData;
    private previewFolderUri: vscode.Uri | undefined;
    private previewWatcher: vscode.Disposable | undefined;
    private _isRefreshingPrereqs = false;
    private _refreshPrereqsTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(planData: ScaffoldPlanData, sourceFileUri?: vscode.Uri, private readonly onSelfWrite?: (content: string) => void) {
        super(ext.context, 'Project Plan', 'scaffoldPlanView', {}, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.sourceFileUri = sourceFileUri;
        this.planData = planData;
        this.previewFolderUri = resolvePreviewFolderUri(sourceFileUri);
        this.setupPreviewWatcher();

        this.panel.onDidDispose(() => {
            this.previewWatcher?.dispose();
            this.previewWatcher = undefined;
            if (this._refreshPrereqsTimer) {
                clearTimeout(this._refreshPrereqsTimer);
                this._refreshPrereqsTimer = undefined;
            }
        });

        this.panel.webview.onDidReceiveMessage((message: { command: string; data?: ScaffoldPlanData; prompt?: string; autopilot?: boolean; changes?: { token?: string; hex?: string }[] }) => {
            switch (message.command) {
                case 'ready':
                    void this.panel.webview.postMessage({ command: 'setPlanData', data: this.planData });
                    void this.postPreviewPages();
                    break;
                case 'approvePlan':
                    void this.approvePlan(!!message.autopilot);
                    break;
                case 'persistPaletteColors':
                    void this.persistPaletteColors(message.changes);
                    break;
                case 'submitPlanFeedback': {
                    const query = message.prompt?.trim();
                    if (!query) {
                        return;
                    }
                    void this.trySubmitPlanFeedback(query);
                    break;
                }
                case 'openSourceFile':
                    openSourceFileOrWarn(this.sourceFileUri);
                    break;
                case 'refreshPrerequisites':
                    void this.refreshPrerequisites(!!message.autopilot);
                    break;
            }
        });
    }

    /**
     * Persist palette color picks back into `.azure/project-plan.md` so a changed
     * color survives a reopen and the scaffold agent uses it. Writes the plan file
     * directly (no agent round-trip); the self-write notifier suppresses the echo
     * reload so pending feedback edits are not wiped.
     */
    private async persistPaletteColors(changes: { token?: string; hex?: string }[] | undefined): Promise<void> {
        if (!this.sourceFileUri || !Array.isArray(changes) || changes.length === 0) {
            return;
        }
        const valid = changes.filter(
            (c): c is { token: string; hex: string } => typeof c?.token === 'string' && typeof c?.hex === 'string',
        );
        if (valid.length === 0) {
            return;
        }
        try {
            const raw = Buffer.from(await vscode.workspace.fs.readFile(this.sourceFileUri)).toString('utf-8');
            const updated = applyPaletteHexToMarkdown(raw, valid);
            if (updated === raw) {
                return;
            }
            this.onSelfWrite?.(updated);
            await vscode.workspace.fs.writeFile(this.sourceFileUri, Buffer.from(updated, 'utf-8'));
        } catch (err) {
            ext.outputChannel.appendLog(`[ScaffoldPlanView] palette persist failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    private async approvePlan(autopilot: boolean): Promise<void> {
        return await callWithTelemetryAndErrorHandling(corId('submitScaffoldPlanApproval'), async (actionContext: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'submitScaffoldPlanApproval' }, async (context: CopilotOnRailsContext) => {
                if (!(await this.trySubmitPlanApproval(context, autopilot))) {
                    return;
                }

                suppressTrackedViewCloseOnce();
                this.recordPlanTelemetry(context);
                this.panel.dispose();

                openLoadingView({
                    stage: 0,
                    title: vscode.l10n.t('Scaffolding your project…'),
                    message: vscode.l10n.t('Copilot is creating your project files. For progress please view the Copilot chat.'),
                    showNeedHelp: true,
                });
            });
        });
    }

    private recordPlanTelemetry(context: CopilotOnRailsContext): void {
        try {
            const telemetry = getScaffoldPlanTelemetry(this.planData);
            for (const [key, value] of Object.entries(telemetry)) {
                setCorProp(context, `${SCAFFOLD_PLAN_TELEMETRY_PREFIX}${key}`, value);
            }
        } catch {
            // Telemetry extraction must never block the approval flow; swallow any parsing errors.
            setCorProp(context, `${SCAFFOLD_PLAN_TELEMETRY_PREFIX}parseFailed`, true);
        }
    }

    private async trySubmitPlanApproval(context: CopilotOnRailsContext, autopilot: boolean): Promise<boolean> {
        const approvalOutcomeKey = 'approvalOutcome';
        let confirmedAutopilot = false;
        if (autopilot) {
            confirmedAutopilot = await this.confirmAutopilot();
            if (!confirmedAutopilot) {
                // Autopilot was requested but the confirmation dialog was declined.
                setCorProp(context, 'autopilot', false);
                setCorProp(context, approvalOutcomeKey, 'confirmationDeclined');
                return false;
            }
        }
        setCorProp(context, 'autopilot', confirmedAutopilot);

        await ensureAgentInstructions(context, 'azure-project-scaffold');

        const planBeforeApproval = this.sourceFileUri
            ? await writeProjectPlanStatusAtUri(this.sourceFileUri, ProjectPlanStatus.approved)
            : undefined;
        setCorProp(context, 'statusWriteSucceeded', planBeforeApproval !== undefined);
        if (planBeforeApproval !== undefined) {
            const approvedPlan = replaceProjectPlanStatus(planBeforeApproval, ProjectPlanStatus.approved);
            if (approvedPlan !== undefined) {
                this.onSelfWrite?.(approvedPlan);
            }
        }

        if (confirmedAutopilot) {
            await this.recordAutopilotMode();
        }
        if (confirmedAutopilot) {
            await enableAutopilot(ext.context);
        } else {
            await this.ensureRequestBudget();
        }

        const baseQuery = vscode.l10n.t('I approve the plan.');
        if (!(await launchAgentChat(context, azureProjectScaffoldAgent, confirmedAutopilot ? `${AUTOPILOT_QUERY_MARKER} ${baseQuery}` : baseQuery))) {
            if (confirmedAutopilot) {
                await disableAutopilot();
            }
            // Undo the approval because scaffolding did not start, leaving the plan ready to retry.
            if (planBeforeApproval !== undefined && this.sourceFileUri) {
                await vscode.workspace.fs.writeFile(this.sourceFileUri, Buffer.from(planBeforeApproval, 'utf-8'));
                this.onSelfWrite?.(planBeforeApproval);
            }
            setCorProp(context, approvalOutcomeKey, 'launchFailed');
            return false;
        }
        setCorProp(context, approvalOutcomeKey, 'submitted');
        return true;
    }

    private async confirmAutopilot(): Promise<boolean> {
        const enableAutopilotTitle = vscode.l10n.t('Enable Autopilot');
        const result = await vscode.window.showWarningMessage(
            vscode.l10n.t('Approve this plan and run the rest in Autopilot mode?'),
            {
                modal: true,
                detail: vscode.l10n.t('Autopilot scaffolds and sets up local debugging without stopping for further approvals. While it runs, all chat tool actions (including file edits and terminal commands) are auto-approved globally, and the chat request limit is raised so the run doesn\'t pause partway through. You can turn this off any time from the status bar.'),
            },
            enableAutopilotTitle,
        );
        return result === enableAutopilotTitle;
    }

    private async trySubmitPlanFeedback(query: string): Promise<boolean> {
        return await callWithTelemetryAndErrorHandling(corId('submitScaffoldPlanFeedback'), async (actionContext: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'submitScaffoldPlanFeedback' }, async (context: CopilotOnRailsContext) => {
                // Reuse the current session so the agent iterates on the plan with the existing conversation.
                await vscode.commands.executeCommand('workbench.action.chat.open', await buildChatOpenOptions(context, {
                    mode: 'agent',
                    query,
                }));
                void this.panel.webview.postMessage({ command: 'revisionInProgress' });

                setCorProp(context, 'feedbackOutcome', 'submitted');
                return true;
            });
        }) ?? false;
    }

    /** For guided runs, optionally raises `chat.agent.maxRequests`. */
    private async ensureRequestBudget(): Promise<void> {
        const current = getEffectiveMaxRequests();
        if (typeof current === 'number' && current >= MIN_RECOMMENDED_MAX_REQUESTS) {
            return;
        }
        if (!vscode.workspace.workspaceFolders?.length) {
            return;
        }
        await callWithTelemetryAndErrorHandling(corId('requestBudgetWarning'), async (context: IActionContext) => {
            context.errorHandling.suppressDisplay = true;
            const yes: vscode.MessageItem = { title: vscode.l10n.t('Yes') };
            const no: vscode.MessageItem = { title: vscode.l10n.t('No'), isCloseAffordance: true };
            const result = await context.ui.showWarningMessage(
                vscode.l10n.t('Raise the chat request limit for this workspace?'),
                {
                    modal: true,
                    detail: vscode.l10n.t('Your chat request limit (chat.agent.maxRequests) is low, so Copilot may pause partway through scaffolding and ask you to continue. Raise the limit for this workspace so scaffolding can run without interruption?'),
                },
                yes,
                no,
            );
            if (result === yes) {
                await raiseWorkspaceMaxRequests();
            }
        });
    }

    /**
     * Records autopilot mode in the plan file for downstream agents to reference.
     * Returns the previous content when the file changed so a failed launch can
     * restore it. No-ops if the source file is unknown or autopilot is already recorded.
     */
    private async recordAutopilotMode(): Promise<string | undefined> {
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
                return raw;
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
            return raw;
        } catch {
            // Best-effort: if we can't persist the marker, the chat query marker
            // still carries autopilot into the scaffold agent.
            return undefined;
        }
    }

    private clearPrereqsRefresh(): void {
        if (this._refreshPrereqsTimer) {
            clearTimeout(this._refreshPrereqsTimer);
            this._refreshPrereqsTimer = undefined;
        }
        if (this._isRefreshingPrereqs) {
            this._isRefreshingPrereqs = false;
            void this.panel.webview.postMessage({ command: 'prerequisitesRefreshComplete' });
        }
    }

    private async refreshPrerequisites(autopilot: boolean): Promise<void> {
        await callWithTelemetryAndErrorHandling(corId('refreshScaffoldPrerequisites'), async (actionContext: IActionContext) => {
            actionContext.errorHandling.suppressDisplay = true;
            await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'refreshScaffoldPrerequisites' }, async (context: CopilotOnRailsContext) => {
                setCorProp(context, 'autopilot', autopilot);

                const refreshOutcomeKey = 'refreshOutcome';
                await ensureAgentInstructions(context, 'azure-project-plan');

                this._isRefreshingPrereqs = true;
                void this.panel.webview.postMessage({ command: 'prerequisitesRefreshing' });

                const query = autopilot
                    ? 'Re-check the prerequisites section only. Re-run the installed/version checks for every tool and extension in the Prerequisites tables and update the plan file with the current results.'
                    : 'Re-check the prerequisites section only. Re-run the installed/version checks for every tool and extension in the Run Prerequisites table only and update the plan file with the current results.';

                await vscode.commands.executeCommand('workbench.action.chat.open', await buildChatOpenOptions(context, {
                    mode: 'azure-project-plan',
                    query,
                }));
                setCorProp(context, refreshOutcomeKey, 'submitted');

                if (this._refreshPrereqsTimer) {
                    clearTimeout(this._refreshPrereqsTimer);
                }
                this._refreshPrereqsTimer = setTimeout(() => {
                    this._refreshPrereqsTimer = undefined;
                    this.clearPrereqsRefresh();
                }, 15_000);
            });
        });
    }

    updatePlanData(planData: ScaffoldPlanData, sourceFileUri?: vscode.Uri): void {
        this.planData = planData;
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
        this.clearPrereqsRefresh();
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

/** Normalize a hex string to a leading-`#` form. */
function normalizeHex(hex: string): string {
    const trimmed = hex.trim();
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

/**
 * Rewrite the hex value(s) in the plan's Color Palette markdown table for the
 * given tokens, preserving the surrounding table formatting. Returns the content
 * unchanged when no matching palette table/row is found. Mirrors the parser's
 * column detection (a header row with a `Token` column and a `Color`/`Hex`/
 * `Value` column).
 */
function applyPaletteHexToMarkdown(content: string, changes: { token: string; hex: string }[]): string {
    const byToken = new Map<string, string>();
    for (const change of changes) {
        if (change.token && change.hex) {
            byToken.set(change.token, normalizeHex(change.hex));
        }
    }
    if (byToken.size === 0) {
        return content;
    }

    const lines = content.split('\n');
    let tokenCol = -1;
    let hexCol = -1;
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim().startsWith('|')) {
            continue;
        }
        const headers = splitTableRow(lines[i]).map(cell => cell.trim().toLowerCase());
        const tIdx = headers.findIndex(h => h === 'token');
        const hIdx = headers.findIndex(h => h === 'color' || h === 'hex' || h === 'value');
        if (tIdx >= 0 && hIdx >= 0) {
            tokenCol = tIdx;
            hexCol = hIdx;
            headerIdx = i;
            break;
        }
    }
    if (headerIdx < 0) {
        return content;
    }

    // Body rows begin after the header separator line (`|---|---|`).
    for (let i = headerIdx + 2; i < lines.length; i++) {
        if (!lines[i].trim().startsWith('|')) {
            break;
        }
        const cells = splitTableRow(lines[i]);
        if (tokenCol >= cells.length || hexCol >= cells.length) {
            continue;
        }
        const newHex = byToken.get(cells[tokenCol].trim());
        if (!newHex) {
            continue;
        }
        cells[hexCol] = cells[hexCol].replace(/#?[0-9a-fA-F]{3,8}/, newHex);
        lines[i] = rebuildTableRow(lines[i], cells);
    }
    return lines.join('\n');
}

/** Split a markdown table row into its raw inner cells (spacing preserved). */
function splitTableRow(line: string): string[] {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
}

/** Reassemble a table row from raw cells, preserving the line's indentation. */
function rebuildTableRow(originalLine: string, cells: string[]): string {
    const indent = originalLine.match(/^\s*/)?.[0] ?? '';
    return `${indent}|${cells.join('|')}|`;
}
