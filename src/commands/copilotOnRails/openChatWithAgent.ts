/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { projectSubmissionState } from '../../tree/project/projectSubmissionState';
import { CopilotOnRailsContext } from '../../utils/copilotOnRails/CopilotOnRailsContext';
import { setCorErrorProp, setCorProp } from '../../utils/copilotOnRails/telemetryUtils';
import { openLoadingView } from '../../webviews/copilotOnRails/extension/openLoadingView';
import { getSessionModel, recordAgentLaunch } from '../../webviews/copilotOnRails/extension/projectSession';
import { saveReloadResumePrompt } from '../../webviews/copilotOnRails/extension/reloadResumePrompt';
import { type LoadingViewConfiguration } from '../../webviews/copilotOnRails/views/utils/viewConfigTypes';
import { ensureAgentInstructions } from './agentInstructions';

const COPILOT_CHAT_EXTENSION_ID = 'GitHub.copilot-chat';
// VS Code's Workspace Trust command that opens the native Manage Workspace Trust editor.
const MANAGE_WORKSPACE_TRUST_COMMAND_ID = 'workbench.trust.manage';
const RELOAD_WINDOW_COMMAND_ID = 'workbench.action.reloadWindow';
let agentLaunchInProgress = false;

// True once this window session was blocked by an untrusted workspace (either detected when
// a launch was attempted, or observed via a mid-session trust grant). When set, Copilot Chat
// came up with a stale custom-mode registry that granting trust doesn't refresh, so launching
// a custom agent would silently fall back to the default Agent until the window is reloaded.
let workspaceTrustWasRestrictedThisSession = false;

/**
 * Tracks whether Workspace Trust was granted mid-session (including via VS Code's own
 * banner) so we can tell whether a freshly-installed agent needs a window reload to be
 * discovered.
 */
export function registerWorkspaceTrustTracking(): void {
    ext.context.subscriptions.push(
        vscode.workspace.onDidGrantWorkspaceTrust(() => {
            workspaceTrustWasRestrictedThisSession = true;
        }),
    );
}

/**
 * Resolves a user-facing model name (e.g. "Claude Opus 4.7 (copilot)") to a
 * modelSelector object that VS Code's chat commands expect.
 */
async function resolveModelSelector(displayName: string): Promise<{ id?: string; vendor?: string } | undefined> {
    try {
        const models = await vscode.lm.selectChatModels();
        // Try matching by "Name (vendor)" format: e.g. "Claude Opus 4.7 (copilot)"
        const vendorMatch = displayName.match(/^(.+?)\s*\((\w+)\)\s*$/);
        if (vendorMatch) {
            const [, name, vendor] = vendorMatch;
            const match = models.find(
                (m) => m.name === name.trim() && m.vendor === vendor,
            );
            if (match) {
                return { id: match.id, vendor: match.vendor };
            }
        }
        // Try matching by name alone
        const byName = models.find((m) => m.name === displayName);
        if (byName) {
            return { id: byName.id, vendor: byName.vendor };
        }
        // Try matching by id (in case the caller already has the id)
        const byId = models.find((m) => m.id === displayName);
        if (byId) {
            return { id: byId.id, vendor: byId.vendor };
        }
    } catch {
        // If the lm API isn't available, fall through
    }
    return undefined;
}

/**
 * Ensure the GitHub Copilot Chat extension is installed and activated before invoking
 * `workbench.action.chat.open`. Custom chat agents contributed via `package.json`
 * (`chatAgents`) are not registered until that extension activates, so opening chat
 * with a `mode` referring to one of them silently no-ops if we don't wait.
 */
export async function ensureCopilotChatReady(context: CopilotOnRailsContext): Promise<boolean> {
    const ensureCopilotChatOutcomeKey = 'ensureCopilotChatOutcome';

    // Copilot on Rails cannot run in a restricted (untrusted) workspace. VS Code's
    // Workspace Trust disables GitHub Copilot Chat, and a trust-disabled extension is
    // filtered out of the running set so `getExtension` returns `undefined`. Check
    // trust first and surface an accurate Workspace Trust error rather than letting
    // the check below report a misleading "not installed".
    //
    // The error offers a "Manage Workspace Trust" action that runs the stable built-in
    // `workbench.trust.manage` command, which opens VS Code's Trust management editor
    // where the user grants trust. We do NOT call `vscode.workspace.requestWorkspaceTrust()`
    // - the API that would pop an inline trust modal - because it is still a proposed API.
    // TODO: revisit for a smoother prompt-to-trust experience once the API is stable.
    if (!vscode.workspace.isTrusted) {
        workspaceTrustWasRestrictedThisSession = true;
        setCorProp(context, ensureCopilotChatOutcomeKey, 'workspaceNotTrusted');
        const manageTrust = vscode.l10n.t('Manage Workspace Trust');
        void vscode.window.showErrorMessage(
            vscode.l10n.t('GitHub Copilot Chat is disabled because this folder is not trusted. Trust the folder, then run this command again.'),
            manageTrust,
        ).then((choice) => {
            if (choice === manageTrust) {
                void vscode.commands.executeCommand(MANAGE_WORKSPACE_TRUST_COMMAND_ID);
            }
        });
        return false;
    }

    const copilotChatExtension = vscode.extensions.getExtension(COPILOT_CHAT_EXTENSION_ID);
    setCorProp(context, 'copilotChatInstalled', !!copilotChatExtension);
    setCorProp(context, 'copilotChatVersion', (copilotChatExtension?.packageJSON as { version?: string } | undefined)?.version ?? 'none');

    if (!copilotChatExtension) {
        setCorProp(context, ensureCopilotChatOutcomeKey, 'notInstalled');
        void vscode.window.showErrorMessage(
            vscode.l10n.t('GitHub Copilot Chat is required to continue. Please install the GitHub Copilot Chat extension and try again.'),
        );
        return false;
    }

    if (!copilotChatExtension.isActive) {
        try {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Starting GitHub Copilot Chat...') },
                async () => { await copilotChatExtension.activate(); },
            );
            setCorProp(context, ensureCopilotChatOutcomeKey, 'activated');
        } catch (error) {
            setCorProp(context, ensureCopilotChatOutcomeKey, 'activationFailed');
            setCorErrorProp(context, 'ensureCopilotChatError', parseError(error).message);
            throw error;
        }
        return true;
    }
    setCorProp(context, ensureCopilotChatOutcomeKey, 'alreadyActive');
    return true;
}

export async function launchAgentChat(context: CopilotOnRailsContext, agentName: string, query: string, model?: string): Promise<boolean> {
    setCorProp(context, 'chatQueryLength', query.length);

    const chatLaunchOutcomeKey = 'chatLaunchOutcome';
    if (agentLaunchInProgress) {
        setCorProp(context, chatLaunchOutcomeKey, 'alreadyInProgress');
        void vscode.window.showWarningMessage(
            vscode.l10n.t('Another Copilot agent is still starting. Please wait and try again.'),
        );
        return false;
    }

    agentLaunchInProgress = true;
    try {
        // Start a fresh chat session for this phase hand-off. Agents coordinate through
        // the `.azure/*` plan files on disk, not chat history, so a clean session keeps
        // each agent's context window focused on its own phase instead of accumulating
        // the entire plan → scaffold → debug conversation.
        await vscode.commands.executeCommand('workbench.action.chat.newChat');

        const resolvedModel = model ?? getSessionModel();
        setCorProp(context, 'chatModelSelectionSource', model ? 'newlySelected' : (getSessionModel() ? 'previouslySelected' : 'default'));

        const selector = resolvedModel ? await resolveModelSelector(resolvedModel) : undefined;
        setCorProp(context, 'chatModelResolved', !!selector);

        // Launch the custom agent by passing its mode to the generic chat-open command.
        // For a custom mode, VS Code never registers a per-mode `workbench.action.chat.open<mode>`
        // command (only the built-in Ask/Agent/Edit modes get one) - that id exists only as a
        // mode-picker action item, so it can't be discovered via `getCommands()`. Targeting
        // `workbench.action.chat.open` with a `mode` argument is the supported way to open a
        // custom agent from an extension.
        //
        // Caveat: if `mode` hasn't been discovered yet (VS Code scans `.github/agents/*.agent.md`
        // asynchronously), this SILENTLY falls back to the default Agent - no error - and the
        // prompt runs in the wrong agent. That race is what the reload prompt in
        // prepareAndLaunchAgent avoids: when the session started untrusted we reload before ever
        // reaching this call, so by the time we open the agent the window is trusted from the
        // start and discovery has run normally.
        await vscode.commands.executeCommand('workbench.action.chat.open', {
            mode: agentName,
            query,
            ...(selector ? { modelSelector: selector } : {}),
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setCorProp(context, chatLaunchOutcomeKey, 'error');
        setCorErrorProp(context, 'chatLaunchError', message);
        void vscode.window.showErrorMessage(
            vscode.l10n.t('The "{0}" Copilot agent could not be started: {1}', agentName, message),
        );
        return false;
    } finally {
        agentLaunchInProgress = false;
    }

    // Record the phase we just launched so an interrupted run can be resumed.
    try {
        await recordAgentLaunch(agentName);
        setCorProp(context, 'chatAgentLaunchRecorded', true);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setCorProp(context, 'chatAgentLaunchRecorded', false);
        setCorErrorProp(context, 'chatAgentLaunchRecordError', message);
        ext.outputChannel.warn(vscode.l10n.t('Could not record the "{0}" Copilot agent launch: {1}', agentName, message));
    }
    setCorProp(context, chatLaunchOutcomeKey, 'chatLaunched');
    return true;
}

/** Result of {@link prepareAndLaunchAgent}, mapped by each caller to its own telemetry and terminal UI. */
export type AgentLaunchOutcome = 'chatNotReady' | 'deferred' | 'launchFailed' | 'launched';

export interface PrepareAndLaunchAgentOptions {
    agentName: string;
    prompt: string;
    loading?: LoadingViewConfiguration;
    model?: string;
    /** Skip the chat-ready preflight for callers that already ran it earlier in the flow. */
    skipChatReadyCheck?: boolean;
    /**
     * When the reload-for-agent-discovery guard fires, stash this launch's prompt/model so the
     * create view can be re-opened pre-filled after the reload. Set by the create entry point;
     * other callers just reload without restoring a view.
     */
    restoreCreateViewOnReload?: boolean;
    /** Runs right before handing off — prompting a reload or reporting a successful launch — e.g. to dispose the source panel. */
    onBeforeHandoff?: () => void;
}

/**
 * Shared launch routine for the fresh-agent entry points. Verifies chat is ready, and - when
 * this session started untrusted - prompts a one-time window reload instead of launching,
 * because Copilot Chat can't discover the project's custom agents until it restarts in the
 * now-trusted window. Otherwise downloads the agent's instructions and launches. Callers map
 * the returned outcome to telemetry and terminal UI.
 */
export async function prepareAndLaunchAgent(context: CopilotOnRailsContext, options: PrepareAndLaunchAgentOptions): Promise<AgentLaunchOutcome> {
    const { agentName, prompt, model, skipChatReadyCheck, restoreCreateViewOnReload, onBeforeHandoff } = options;

    // Gate on Workspace Trust (and activate chat) before ensureAgentInstructions writes
    // files, so an untrusted workspace isn't littered with project files it never consented to.
    if (!skipChatReadyCheck && !(await ensureCopilotChatReady(context))) {
        return 'chatNotReady';
    }

    // If this session started untrusted, Copilot Chat is running against a stale custom-mode
    // registry that granting trust mid-session doesn't refresh, so launching a custom agent
    // now would silently fall back to the default Agent. Prompt a one-time reload BEFORE
    // downloading anything; after the reload the user re-runs the command in a healthy window,
    // where the agents download and are discovered normally. Only reachable from a CoR command,
    // so a bare Workspace Trust grant never triggers this on its own.
    //
    // Why reload + re-launch instead of just resuming straight into the agent? We tried the
    // seamless path (download the agents, reload, then auto-open the agent on activation) and
    // it was flaky: VS Code scans `.github/agents/*.agent.md` into its chat-mode registry
    // asynchronously, and `chat.open { mode }` silently no-ops to the default Agent when the
    // mode isn't registered yet (see launchAgentChat). There is no API to query mode readiness
    // or read the active mode, so we can't reliably wait for or verify discovery - any
    // auto-launch is a race we can't observe, and a timer is just a guess. Handing control back
    // to the user (reload, then press Plan again) removes the race: by the time they click, the
    // reloaded window has been trusted from the start and has finished discovering the agents,
    // so the launch lands in the right mode. The cost is one extra click, which we soften by
    // re-opening the create view with their prompt pre-filled (saveReloadResumePrompt).
    if (workspaceTrustWasRestrictedThisSession) {
        if (restoreCreateViewOnReload) {
            await saveReloadResumePrompt(prompt, model);
        }
        onBeforeHandoff?.();
        await promptReloadForAgentDiscovery(context);
        return 'deferred';
    }

    await ensureAgentInstructions(context, agentName);

    if (!(await launchAgentChat(context, agentName, prompt, model))) {
        return 'launchFailed';
    }

    onBeforeHandoff?.();
    return 'launched';
}

export async function openChatWithAgent(context: CopilotOnRailsContext, agentName: string, prompt: string, loading?: LoadingViewConfiguration): Promise<void> {
    setCorProp(context, 'chatAgentName', agentName);

    const key = 'openChatWithAgentOutcome';
    switch (await prepareAndLaunchAgent(context, { agentName, prompt, loading })) {
        case 'chatNotReady':
            setCorProp(context, key, 'copilotChatNotReady');
            return;
        case 'deferred':
            setCorProp(context, key, 'deferredForAgentDiscovery');
            return;
        case 'launchFailed':
            setCorProp(context, key, 'chatlaunchFailed');
            return;
        case 'launched':
            setCorProp(context, key, 'launched');
            if (loading) {
                setCorProp(context, 'openChatLoadingStage', loading.stage);
                projectSubmissionState.setPending(loading.stage);
                openLoadingView(loading);
            }
            return;
    }
}

/**
 * Prompts the user to reload the window so Copilot Chat can pick up the project's custom
 * agents. Fired only from the CoR launch path when this session started untrusted; after the
 * reload the window is trusted from the start and re-running the command downloads and
 * launches the agent normally.
 */
async function promptReloadForAgentDiscovery(context: CopilotOnRailsContext): Promise<void> {
    setCorProp(context, 'promptedReloadForAgentDiscovery', true);
    const reload = vscode.l10n.t('Reload Window');
    const choice = await vscode.window.showInformationMessage(
        vscode.l10n.t('Reload to set up your project'),
        {
            modal: true,
            detail: vscode.l10n.t('VS Code needs to reload this window once so it can load the project\u2019s Copilot agents. After it reloads, start your project again to continue.'),
        },
        reload,
    );
    if (choice === reload) {
        await vscode.commands.executeCommand(RELOAD_WINDOW_COMMAND_ID);
    }
}

/**
 * Builds the options object for a direct `workbench.action.chat.open` call,
 * automatically including the session's model selection when one is stored.
 */
export async function buildChatOpenOptions(context: CopilotOnRailsContext, options: { mode?: string; query: string }): Promise<{ mode?: string; query: string; modelSelector?: { id?: string; vendor?: string } }> {
    setCorProp(context, 'chatQueryLength', options.query.length);
    if (options.mode) {
        setCorProp(context, 'chatAgentName', options.mode);
    }

    const model = getSessionModel();
    setCorProp(context, 'chatModelSelectionSource', model ? 'previouslySelected' : 'default');
    if (model) {
        const selector = await resolveModelSelector(model);
        setCorProp(context, 'chatModelResolved', !!selector);
        return selector ? { ...options, modelSelector: selector } : options;
    }
    return options;
}
