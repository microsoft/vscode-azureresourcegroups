/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { projectSubmissionState } from '../../tree/project/projectSubmissionState';
import { CopilotOnRailsContext } from '../../utils/copilotOnRails/CopilotOnRailsContext';
import { AUTO_CHAT_MODEL, DEFAULT_CHAT_MODEL, resolveCopilotHarnessModelSelector } from '../../utils/copilotOnRails/modelSelection';
import { setCorErrorProp, setCorProp } from '../../utils/copilotOnRails/telemetryUtils';
import { AUTOPILOT_QUERY_MARKER, isAutopilotActive } from '../../webviews/copilotOnRails/extension/autopilot';
import { ensureCopilotHarnessOn, setCopilotCliAutoModelEnabled } from '../../webviews/copilotOnRails/extension/harnessSettings';
import { openLoadingView } from '../../webviews/copilotOnRails/extension/openLoadingView';
import { getSessionModel, recordAgentLaunch } from '../../webviews/copilotOnRails/extension/projectSession';
import { saveReloadResumePrompt } from '../../webviews/copilotOnRails/extension/reloadResumePrompt';
import { type LoadingViewConfiguration } from '../../webviews/copilotOnRails/views/utils/viewConfigTypes';
import { ensureAgentInstructions } from './agentInstructions';

const COPILOT_CHAT_EXTENSION_ID = 'GitHub.copilot-chat';
const MANAGE_WORKSPACE_TRUST_COMMAND_ID = 'workbench.trust.manage';
const RELOAD_WINDOW_COMMAND_ID = 'workbench.action.reloadWindow';
const OPEN_CHAT_COMMAND_ID = 'workbench.action.chat.open';
const NEW_CHAT_COMMAND_ID = 'workbench.action.chat.newChat';
const OPEN_CHAT_COMMAND_PREFIX = 'workbench.action.chat.open';
const AGENT_COMMAND_READY_TIMEOUT_MS = 10_000;
const AGENT_COMMAND_READY_POLL_MS = 100;
const EXISTING_AGENT_COMMAND_SETTLE_MS = 1_000;
let agentLaunchInProgress = false;
let requireWorkspaceTrustReload = false;

export function registerWorkspaceTrustTracking(): void {
    ext.context.subscriptions.push(
        vscode.workspace.onDidGrantWorkspaceTrust(() => {
            requireWorkspaceTrustReload = true;
        }),
    );
}

/**
 * Resolves a user-facing model name (e.g. "Claude Opus 4.7") to a
 * modelSelector object that VS Code's chat commands expect.
 */
export async function resolveModelSelector(displayName: string): Promise<{ id?: string; vendor?: string } | undefined> {
    // If auto or default, defer to VS Code chat, since we don't need to provide any specific model
    if (displayName === DEFAULT_CHAT_MODEL || displayName === AUTO_CHAT_MODEL) {
        return resolveCopilotHarnessModelSelector(displayName, []);
    }

    try {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilotcli' });
        return resolveCopilotHarnessModelSelector(displayName, models);
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

    if (!vscode.workspace.isTrusted) {
        requireWorkspaceTrustReload = true;
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

    await ensureCopilotHarnessOn();

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
        const resolvedModel = model ?? getSessionModel();
        await ensureCopilotHarnessOn({ useAutoModel: resolvedModel === AUTO_CHAT_MODEL });

        // Custom-agent commands are registered from the focused chat widget. Open Chat before
        // creating the fresh session so first-time launches do not wait on a widget that does not exist.
        await vscode.commands.executeCommand(OPEN_CHAT_COMMAND_ID);

        // Fresh chat session per phase hand-off: agents coordinate through the `.azure/*` plan
        // files on disk, not chat history, so a clean session keeps each agent focused on its phase.
        await vscode.commands.executeCommand(NEW_CHAT_COMMAND_ID);

        await waitForAgentModeRegistration(agentName);
        await vscode.commands.executeCommand(getAgentChatOpenCommandId(agentName));
        await vscode.commands.executeCommand(
            OPEN_CHAT_COMMAND_ID,
            buildAgentChatModeOptions(agentName),
        );

        setCorProp(context, 'chatModelSelectionSource', resolvedModel === DEFAULT_CHAT_MODEL ? 'default' : model ? 'newlySelected' : (getSessionModel() ? 'previouslySelected' : 'default'));

        const selector = resolvedModel ? await resolveModelSelector(resolvedModel) : undefined;
        setCorProp(context, 'chatModelResolved', !!selector);
        if (selector) {
            setCorProp(context, 'chatModelSelectorId', selector.id);
            setCorProp(context, 'chatModelSelectorVendor', selector.vendor);
        }

        const result = await vscode.commands.executeCommand<false | undefined>(
            OPEN_CHAT_COMMAND_ID,
            buildAgentChatOpenOptions(agentName, query, selector, isAutopilotActive()),
        );
        if (result === false) {
            throw new Error(vscode.l10n.t(
                'The "{0}" Copilot agent request was rejected.',
                agentName,
            ));
        }
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

export function getAgentChatOpenCommandId(agentName: string): string {
    return `${OPEN_CHAT_COMMAND_PREFIX}${agentName}`;
}

export function buildAgentChatModeOptions(agentName: string): { mode: string } {
    return { mode: agentName };
}

export function buildAgentChatOpenOptions(
    agentName: string,
    query: string,
    modelSelector?: { id?: string; vendor?: string },
    autopilot = false,
): { mode: string; query: string; modelSelector?: { id?: string; vendor?: string }; waitForRequestAcceptance: true } {
    return {
        mode: agentName,
        query: autopilot && !query.startsWith(AUTOPILOT_QUERY_MARKER) ? `${AUTOPILOT_QUERY_MARKER} ${query}` : query,
        ...(modelSelector ? { modelSelector } : {}),
        waitForRequestAcceptance: true,
    };
}

async function waitForAgentModeRegistration(agentName: string): Promise<void> {
    const commandId = getAgentChatOpenCommandId(agentName);
    const deadline = Date.now() + AGENT_COMMAND_READY_TIMEOUT_MS;
    let commandWasAlreadyRegistered = false;

    do {
        if ((await vscode.commands.getCommands(true)).includes(commandId)) {
            if (!commandWasAlreadyRegistered) {
                commandWasAlreadyRegistered = true;
                await new Promise(resolve => setTimeout(resolve, EXISTING_AGENT_COMMAND_SETTLE_MS));
                continue;
            }
            return;
        }
        commandWasAlreadyRegistered = false;
        await new Promise(resolve => setTimeout(resolve, AGENT_COMMAND_READY_POLL_MS));
    } while (Date.now() < deadline);

    throw new Error(vscode.l10n.t(
        'The "{0}" Copilot agent was not registered for the selected chat harness.',
        agentName,
    ));
}

/** Result of {@link prepareAndLaunchAgent}; consumed by {@link launchAgentAndRecordOutcome}. */
type AgentLaunchOutcome = 'chatNotReady' | 'deferred' | 'launchFailed' | 'launched';

export interface PrepareAndLaunchAgentOptions {
    agentName: string;
    prompt: string;
    model?: string;
    /** Skip the chat-ready preflight for callers that already ran it earlier in the flow. */
    skipChatReadyCheck?: boolean;
    /** Stash this launch's prompt/model so the create view can be re-opened pre-filled after a reload. */
    restoreCreateViewOnReload?: boolean;
    /** Runs right before handing off (reload prompt or successful launch), e.g. to dispose the source panel. */
    onBeforeHandoff?: () => void;
}

/**
 * Shared launch routine for the fresh-agent entry points. Readies chat, and - when this session
 * needs a workspace-trust reload - prompts that reload instead of launching. Otherwise writes the
 * agent's instructions and launches.
 */
async function prepareAndLaunchAgent(context: CopilotOnRailsContext, options: PrepareAndLaunchAgentOptions): Promise<AgentLaunchOutcome> {
    const { agentName, prompt, model, skipChatReadyCheck, restoreCreateViewOnReload, onBeforeHandoff } = options;

    // Gate on trust before ensureAgentInstructions writes files, so an untrusted workspace
    // isn't littered with project files it never consented to.
    if (!skipChatReadyCheck && !(await ensureCopilotChatReady(context))) {
        return 'chatNotReady';
    }

    // Prompt a one-time reload before writing anything, and hand control back to the user rather
    // than auto-launching: agent discovery is async with no readiness API, so any auto-launch
    // would race. restoreCreateViewOnReload re-opens the create view pre-filled to soften it.
    if (requireWorkspaceTrustReload) {
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

/**
 * Runs {@link prepareAndLaunchAgent}, records the abort outcomes as telemetry under `outcomeKey`,
 * and returns true only when the agent launched - so callers write just their success path.
 */
export async function launchAgentAndRecordOutcome(context: CopilotOnRailsContext, outcomeKey: string, options: PrepareAndLaunchAgentOptions): Promise<boolean> {
    switch (await prepareAndLaunchAgent(context, options)) {
        case 'chatNotReady':
            setCorProp(context, outcomeKey, 'copilotChatNotReady');
            return false;
        case 'deferred':
            setCorProp(context, outcomeKey, 'deferredForAgentDiscovery');
            return false;
        case 'launchFailed':
            setCorProp(context, outcomeKey, 'launchFailed');
            return false;
        case 'launched':
            return true;
    }
}

export async function openChatWithAgent(context: CopilotOnRailsContext, agentName: string, prompt: string, loading?: LoadingViewConfiguration): Promise<void> {
    setCorProp(context, 'chatAgentName', agentName);

    const key = 'openChatWithAgentOutcome';
    if (await launchAgentAndRecordOutcome(context, key, { agentName, prompt })) {
        setCorProp(context, key, 'launched');
        if (loading) {
            setCorProp(context, 'openChatLoadingStage', loading.stage);
            projectSubmissionState.setPending(loading.stage);
            openLoadingView(loading);
        }
    }
}

/** Prompts a one-time window reload so Copilot Chat can discover the project's custom agents. */
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
    await setCopilotCliAutoModelEnabled(model === AUTO_CHAT_MODEL);
    setCorProp(context, 'chatModelSelectionSource', model && model !== DEFAULT_CHAT_MODEL ? 'previouslySelected' : 'default');
    if (model) {
        const selector = await resolveModelSelector(model);
        setCorProp(context, 'chatModelResolved', !!selector);
        if (selector) {
            setCorProp(context, 'chatModelSelectorId', selector.id);
            setCorProp(context, 'chatModelSelectorVendor', selector.vendor);
        }
        return selector ? { ...options, modelSelector: selector } : options;
    }
    return options;
}
