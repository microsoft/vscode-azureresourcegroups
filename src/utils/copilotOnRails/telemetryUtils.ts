/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext, maskUserInfo, parseError, UserCancelledError } from "@microsoft/vscode-azext-utils";
import { ToolExecutionExtras } from "@microsoft/vscode-inproc-mcp";
import * as os from "os";
import { v4 as uuidv4 } from "uuid";
import * as vscode from "vscode";
import { ext } from "../../extensionVariables";
import { isAutopilotActive } from "../../webviews/copilotOnRails/extension/autopilot";
import { readSessionState } from "../../webviews/copilotOnRails/extension/projectSession";
import { CopilotOnRailsContext, ensureRequiredCopilotOnRailsContext } from "./CopilotOnRailsContext";
import { DiagnosticEvent, withDiagnosticEvents } from "./diagnosticUtils";
import {
    type CorLifecycleState,
    type CorWorkflowEntryPoint,
    ensureCorWorkflow,
    getCorWorkflowTelemetry,
    markCorWorkflowWaiting,
    normalizeCorToolName,
    recordCorUserWait,
    recordCorToolCall,
    resumeCorWorkflow,
} from "./workflowContext";

/**
 * Builds a standardized Copilot on Rails identifier for command ids and telemetry.
 * The id will always be prefixed with `copilotOnRails.`.
 */
export function corId(name: string): string {
    return `copilotOnRails.${name}`;
}

export const COR_PROJECT_ID_KEY = 'copilotOnRails.projectId';
let projectIdCache: string | undefined;

/**
 * Returns the persistent project guid associated with the workspace project.
 * Automatically handles generating and caching one on first use.
 *
 * Note: The project guid is important for stitching together the full chain of Copilot on Rails telemetry.
 */
export function getCorProjectId(): string {
    let projectId: string | undefined = projectIdCache ?? ext.context.workspaceState.get(COR_PROJECT_ID_KEY);
    if (!projectId) {
        projectId = uuidv4();
        void ext.context.workspaceState.update(COR_PROJECT_ID_KEY, projectId);
    }
    projectIdCache = projectId;
    return projectId;
}

export async function restoreCorProjectId(projectId: string): Promise<void> {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
        projectIdCache = projectId;
        await ext.context.workspaceState.update(COR_PROJECT_ID_KEY, projectId);
    }
}

/**
 * Prepares a {@link CopilotOnRailsContext} and runs a provided `command` inside the Copilot on Rails
 * diagnostic-event lifecycle. This is the single entrypoint-agnostic wrapper. Both the extension-command
 * registration and the MCP tools should call it, so the invoked command receives the same context
 * shape regardless of how it was reached.
 */
export async function callWithDiagnosticsAndTelemetryHandling<T>(
    context: IActionContext,
    eventDetails: { type: DiagnosticEvent['type']; name: string; extras?: ToolExecutionExtras; entryPoint?: CorWorkflowEntryPoint },
    command: (context: CopilotOnRailsContext) => Promise<T>,
): Promise<T> {
    const startedAt = Date.now();
    const entryPoint = eventDetails.entryPoint ?? entryPointFor(eventDetails.type);
    await ensureCorWorkflow(entryPoint);

    context.telemetry.properties.isCopilotEvent = 'true';
    context.telemetry.properties.corProjectId = getCorProjectId();

    if (eventDetails.extras) {
        context.telemetry.properties.copilotSessionId = eventDetails.extras.sessionId;
        context.telemetry.properties.copilotRequestId = eventDetails.extras.requestId.toString();
    }

    const corContext: CopilotOnRailsContext = ensureRequiredCopilotOnRailsContext(context);
    const precedingUserWaitDurationMs = await resumeCorWorkflow(startedAt);
    corContext.corTiming = { userWaitDurationMs: 0 };
    context.telemetry.measurements.precedingUserWaitDurationMs = precedingUserWaitDurationMs;
    context.telemetry.properties.entryPoint = entryPoint;
    context.telemetry.properties.startedTimestamp = new Date(startedAt).toISOString();
    context.telemetry.properties.startTimestamp = context.telemetry.properties.startedTimestamp;
    context.telemetry.properties.lifecycleState = 'started';
    applyCorWorkflowTelemetry(context);

    // Intentionally telemetry only since this data was already cached on the worspace level for diagnostics
    for (const [key, value] of Object.entries(getSystemInfo())) {
        context.telemetry.properties[key] = value;
    }

    const copilotModel: string | undefined = readSessionState()?.model;
    if (copilotModel) {
        setCorProp(corContext, 'copilotModel', copilotModel);
        context.telemetry.properties.requestedModel = copilotModel;
    }
    context.telemetry.properties.requestedModelAvailable = copilotModel ? 'true' : 'false';

    setCorProp(corContext, 'autopilot', isAutopilotActive());
    context.telemetry.properties.workflowMode = isAutopilotActive() ? 'autopilot' : 'guided';
    context.telemetry.properties.servedModelAvailable = 'false';
    context.telemetry.properties.modelRoutingDetailsAvailable = 'false';
    context.telemetry.properties.tokenUsageAvailable = 'false';
    context.telemetry.properties.contextCompressionMetricsAvailable = 'false';
    context.telemetry.properties.modelTurnCountAvailable = 'false';
    context.telemetry.properties.extensionVersion = ext.version ?? 'unknown';
    context.telemetry.properties.agentVersionAvailable = 'false';
    context.telemetry.properties.skillVersionAvailable = 'false';

    let result: T;
    try {
        result = await withDiagnosticEvents(corContext, { type: eventDetails.type, name: eventDetails.name }, async () => await command(corContext));
        if (context.telemetry.properties.lifecycleState === 'started') {
            context.telemetry.properties.lifecycleState = 'succeeded';
        }
    } catch (error) {
        if (error instanceof UserCancelledError) {
            context.telemetry.properties.lifecycleState = 'canceled';
            context.telemetry.properties.cancelReason = 'userCanceled';
        } else {
            context.telemetry.properties.lifecycleState = 'failed';
            context.telemetry.properties.failureCategory = normalizeCorFailureCategory(parseError(error).message);
        }
        throw error;
    } finally {
        const completedAt = Date.now();
        const durationMs = Math.max(0, completedAt - startedAt);
        if (eventDetails.type === 'mcpTool') {
            await recordCorToolCall(eventDetails.name, durationMs);
            context.telemetry.properties.toolName = normalizeCorToolName(eventDetails.name);
            context.telemetry.measurements.currentToolDurationMs = durationMs;
        }
        context.telemetry.properties.completedTimestamp = new Date(completedAt).toISOString();
        context.telemetry.properties.endTimestamp = context.telemetry.properties.completedTimestamp;
        context.telemetry.measurements.actionDurationMs = durationMs;
        context.telemetry.measurements.actionUserWaitDurationMs = corContext.corTiming?.userWaitDurationMs ?? 0;
        context.telemetry.measurements.actionActiveDurationMs = Math.max(0, durationMs - (corContext.corTiming?.userWaitDurationMs ?? 0));
        applyCorWorkflowTelemetry(context, completedAt);

        if (context.telemetry.properties.lifecycleState === 'succeeded' && beginsUserWait(eventDetails.name)) {
            await markCorWorkflowWaiting(completedAt);
        }
    }
    return result;
}

export async function withCorUserWait<T>(context: CopilotOnRailsContext, wait: () => Thenable<T> | Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
        return await wait();
    } finally {
        const durationMs = Math.max(0, Date.now() - startedAt);
        const timing = ensureRequiredCopilotOnRailsContext(context).corTiming ??= { userWaitDurationMs: 0 };
        timing.userWaitDurationMs += durationMs;
        await recordCorUserWait(durationMs);
    }
}

export function setCorLifecycleState(context: CopilotOnRailsContext, lifecycleState: CorLifecycleState, reason?: string): void {
    context.telemetry.properties.lifecycleState = lifecycleState;
    if (!reason) {
        return;
    }
    if (lifecycleState === 'canceled') {
        context.telemetry.properties.cancelReason = normalizeCorReason(reason, ['userCanceled', 'viewClosed', 'stoppedOrUnavailable']);
    } else if (lifecycleState === 'skipped') {
        context.telemetry.properties.skipReason = normalizeCorReason(reason, ['reloadRequired', 'copilotChatNotReady', 'notApplicable']);
    } else if (lifecycleState === 'failed') {
        context.telemetry.properties.failureCategory = normalizeCorFailureCategory(reason);
    }
}

export async function reportCorBackgroundEvent(
    eventName: string,
    properties: Record<string, string | number | boolean> = {},
    measurements: Record<string, number> = {},
): Promise<void> {
    await callWithTelemetryAndErrorHandling(eventName, async (context: IActionContext) => {
        context.errorHandling.suppressDisplay = true;
        await callWithDiagnosticsAndTelemetryHandling(
            context,
            { type: 'extensionAction', name: eventName, entryPoint: 'background' },
            async (corContext) => {
                for (const [key, value] of Object.entries(properties)) {
                    setCorProp(corContext, key, value);
                }
                Object.assign(context.telemetry.measurements, measurements);
            },
        );
    });
}

export function applyCorWorkflowTelemetry(context: IActionContext, now: number = Date.now()): void {
    const telemetry = getCorWorkflowTelemetry(now);
    if (!telemetry) {
        return;
    }
    Object.assign(context.telemetry.properties, telemetry.properties);
    Object.assign(context.telemetry.measurements, telemetry.measurements);
}

export function normalizeCorFailureCategory(message: string): string {
    const normalized = message.toLowerCase();
    if (/\bcancel(?:ed|led|lation)?\b/.test(normalized)) {
        return 'canceled';
    }
    if (/\b(?:401|unauthenticated|authentication|sign[ -]?in|credential)\b/.test(normalized)) {
        return 'authentication';
    }
    if (/\b(?:403|forbidden|authorization|permission|access denied)\b/.test(normalized)) {
        return 'authorization';
    }
    if (/\b(?:404|not found|does not exist)\b/.test(normalized)) {
        return 'notFound';
    }
    if (/\b(?:409|conflict|already exists)\b/.test(normalized)) {
        return 'conflict';
    }
    if (/\b(?:429|throttl|rate limit)\b/.test(normalized)) {
        return 'rateLimited';
    }
    if (/\b(?:timeout|timed out|deadline)\b/.test(normalized)) {
        return 'timeout';
    }
    if (/\b(?:network|socket|dns|econn|fetch failed)\b/.test(normalized)) {
        return 'network';
    }
    if (/\b(?:invalid|validation|malformed|parse|schema)\b/.test(normalized)) {
        return 'validation';
    }
    return 'unknown';
}

export function getSystemInfo(): Record<string, string> {
    const systemInfo: Record<string, string> = {
        osPlatform: os.platform(),
        osRelease: os.release(),
        osArch: os.arch(),
        nodeVersion: process.versions.node,
        vscodeVersion: vscode.version,
    };

    const cpuModel: string | undefined = os.cpus()[0]?.model;
    if (cpuModel) {
        systemInfo.cpuModel = cpuModel;
    }

    return systemInfo;
}

/**
 * Call this to set both the diagnostics and telemetry properties.
 *
 * **Important**: Don't call this if combining the two properties could result in a leak of PII (e.g. corProjectId, copilotSessionId, copilotRequestId, etc.)
 */
export function setCorProp(context: CopilotOnRailsContext, key: string, value: unknown): void {
    ensureRequiredCopilotOnRailsContext(context).diagnostics.properties[key] = value;
    context.telemetry.properties[key] = String(value);
}

/**
 * Call this automatically handle setting both the diagnostics and telemetry error message.
 */
export function setCorErrorProp(context: CopilotOnRailsContext, key: string, errorMessage: string): void {
    const maskedMessage = maskUserInfo(errorMessage, context.valuesToMask);
    ensureRequiredCopilotOnRailsContext(context).diagnostics.properties[key] = maskedMessage;
    context.telemetry.properties[key] = normalizeCorFailureCategory(maskedMessage);
}

function entryPointFor(type: DiagnosticEvent['type']): CorWorkflowEntryPoint {
    switch (type) {
        case 'extensionAction':
            return 'extensionCommand';
        case 'mcpTool':
            return 'mcpTool';
        case 'webviewAction':
            return 'webview';
    }
}

function beginsUserWait(name: string): boolean {
    return /(?:^|\.)(?:openRequirementsView|openScaffoldPlanView|openFrontendPreviewView|openScaffoldNextStepsView|openDebugPlanView|openDebugNextStepsView|openDeploymentPlanView)$/.test(name)
        || /^(?:open_requirements_view|open_plan_view|open_frontend_preview_view|open_scaffold_next_steps_view|open_local_plan_view|open_local_next_steps_view|open_deploy_plan_view)$/.test(name);
}

function normalizeCorReason(reason: string, allowed: readonly string[]): string {
    return allowed.includes(reason) ? reason : 'unknown';
}
