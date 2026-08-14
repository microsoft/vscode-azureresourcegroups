/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { projectSubmissionState } from '../../tree/project/projectSubmissionState';
import { CopilotOnRailsContext, ensureRequiredCopilotOnRailsContext } from '../../utils/copilotOnRails/CopilotOnRailsContext';
import { setCorErrorProp, setCorProp } from '../../utils/copilotOnRails/telemetryUtils';
import { openLoadingView } from '../../webviews/copilotOnRails/extension/openLoadingView';
import { getSessionModel, recordAgentLaunch } from '../../webviews/copilotOnRails/extension/projectSession';
import { type LoadingViewConfiguration } from '../../webviews/copilotOnRails/views/utils/viewConfigTypes';
import { ensureAgentInstructions } from './agentInstructions';

const COPILOT_CHAT_EXTENSION_ID = 'GitHub.copilot-chat';
const CUSTOM_AGENT_COMMAND_PREFIX = 'workbench.action.chat.open';
const CUSTOM_AGENT_LOAD_TIMEOUT_MS = 10_000;
const CUSTOM_AGENT_LOAD_POLL_INTERVAL_MS = 100;
// VS Code's Workspace Trust command that opens the native Manage Workspace Trust editor.
const MANAGE_WORKSPACE_TRUST_COMMAND_ID = 'workbench.trust.manage';
let agentLaunchInProgress = false;

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

/**
 * A fresh session is started for each phase hand-off because agents communicate
 * through the `.azure/*` plan files on disk, not chat history, so a clean session
 * keeps each agent's context window focused on its own phase instead of
 * accumulating the entire plan → scaffold → debug conversation.
 */
async function waitForCustomAgentCommand(agentName: string): Promise<string | undefined> {
    const commandId = `${CUSTOM_AGENT_COMMAND_PREFIX}${agentName}`;
    const deadline = Date.now() + CUSTOM_AGENT_LOAD_TIMEOUT_MS;

    do {
        if ((await vscode.commands.getCommands()).includes(commandId)) {
            return commandId;
        }
        await new Promise(resolve => setTimeout(resolve, CUSTOM_AGENT_LOAD_POLL_INTERVAL_MS));
    } while (Date.now() < deadline);

    return undefined;
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
        // Revealing chat initializes its custom-mode registry. The agent-specific
        // command appears only after VS Code has finished loading that registry.
        await vscode.commands.executeCommand('workbench.action.chat.open');

        const waitStart = Date.now();
        const commandId = await waitForCustomAgentCommand(agentName);
        const agentWaitMs = Date.now() - waitStart;
        context.telemetry.measurements.chatAgentCommandWaitMs = agentWaitMs;
        ensureRequiredCopilotOnRailsContext(context).diagnostics.properties.chatAgentCommandWaitMs = agentWaitMs;

        if (!commandId) {
            setCorProp(context, chatLaunchOutcomeKey, 'agentCommandTimeout');
            void vscode.window.showErrorMessage(
                vscode.l10n.t('The "{0}" Copilot agent did not finish loading. Please try again.', agentName),
            );
            return false;
        }

        await vscode.commands.executeCommand('workbench.action.chat.newChat');

        const resolvedModel = model ?? getSessionModel();
        setCorProp(context, 'chatModelSelectionSource', model ? 'newlySelected' : (getSessionModel() ? 'previouslySelected' : 'default'));

        const selector = resolvedModel ? await resolveModelSelector(resolvedModel) : undefined;
        setCorProp(context, 'chatModelResolved', !!selector);

        await vscode.commands.executeCommand(commandId, {
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

export async function openChatWithAgent(context: CopilotOnRailsContext, agentName: string, prompt: string, loading?: LoadingViewConfiguration): Promise<void> {
    setCorProp(context, 'chatAgentName', agentName);

    const openChatWithAgentOutcomeKey = 'openChatWithAgentOutcome';
    if (!await ensureAgentInstructions(context, agentName)) {
        setCorProp(context, openChatWithAgentOutcomeKey, 'agentInstructionsMissing');
        return;
    }

    if (!(await ensureCopilotChatReady(context))) {
        setCorProp(context, openChatWithAgentOutcomeKey, 'copilotChatNotReady');
        return;
    }

    if (!(await launchAgentChat(context, agentName, prompt))) {
        setCorProp(context, openChatWithAgentOutcomeKey, 'chatlaunchFailed');
        return;
    }

    setCorProp(context, openChatWithAgentOutcomeKey, 'launched');

    if (loading) {
        setCorProp(context, 'openChatLoadingStage', loading.stage);
        projectSubmissionState.setPending(loading.stage);
        openLoadingView(loading);
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
