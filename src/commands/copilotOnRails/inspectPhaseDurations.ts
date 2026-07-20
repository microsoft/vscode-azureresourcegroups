/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { getDiagnosticEvents } from '../../utils/copilotOnRails/copilotOnRailsDiagnosticUtils';
import { buildPhaseDurationReport, PhaseDurationReport, renderPhaseDurationReportMarkdown } from '../../utils/copilotOnRails/copilotOnRailsPhaseReport';
import { getActiveWorkflowFriction } from '../../webviews/copilotOnRails/extension/telemetry/workflowTelemetry';

/**
 * Builds a per-phase duration report from the workspace-cached Copilot on Rails
 * diagnostic events (requirements → plan → scaffold → integrate → debug → deploy)
 * and opens it as a Markdown document.
 */
export async function inspectPhaseDurations(context: IActionContext): Promise<void> {
    context.telemetry.properties.isCopilotEvent = 'true';

    // Best-effort: merge live friction (approval wait, revisions, autopilot) from
    // the in-progress workflow session. Absent for historical reports.
    const friction = getActiveWorkflowFriction();
    const report = buildPhaseDurationReport(getDiagnosticEvents(), { friction });
    emitPhaseReportTelemetry(context, report);
    if (report.phases.length === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No Copilot on Rails phase activity has been recorded for this workspace yet.'));
        return;
    }

    const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: renderPhaseDurationReportMarkdown(report),
    });
    await vscode.window.showTextDocument(document);
}

/**
 * Emits the derived phase-report metrics as telemetry so the heuristics
 * (run-split threshold, phase mapping, active-vs-idle split, retry/failure
 * detection) can be validated against real-world runs. Only aggregate numeric
 * measurements and enum-like properties are recorded — no free-form content.
 * When a live run is present, `frictionApprovalWaitMs` provides ground truth to
 * reconcile against the derived idle time.
 */
function emitPhaseReportTelemetry(context: IActionContext, report: PhaseDurationReport): void {
    const m = context.telemetry.measurements;
    m.phaseCount = report.phases.length;
    m.totalDurationMs = report.totalDurationMs;
    m.totalActiveToolMs = report.totalActiveToolMs;
    m.totalIdleMs = report.totalIdleMs;
    m.totalRetriedCalls = report.totalRetriedCalls;
    m.maxFailureStreak = report.maxFailureStreak;
    m.revisitCount = report.revisitCount;
    m.unmappedEventCount = report.unmappedEventCount;
    m.priorRunCount = report.priorRunCount;
    m.transitionCount = report.transitions.length;
    if (report.slowestPhase) {
        m.slowestPhaseDurationMs = report.slowestPhase.durationMs;
    }
    if (report.slowestCall) {
        m.slowestCallLatencyMs = report.slowestCall.latencyMs;
    }
    // Per-phase durations keyed by the fixed phase enum (safe cardinality).
    for (const p of report.phases) {
        m[`phase.${p.phase}.durationMs`] = p.durationMs;
        m[`phase.${p.phase}.activeToolMs`] = p.activeToolMs;
        m[`phase.${p.phase}.idleMs`] = p.idleMs;
    }

    const props = context.telemetry.properties;
    props.slowestPhase = report.slowestPhase?.phase ?? 'none';
    props.hasFriction = report.friction ? 'true' : 'false';
    if (report.friction) {
        m.frictionApprovalCount = report.friction.approvalCount;
        m.frictionApprovalWaitMs = report.friction.approvalWaitMs;
        m.frictionRevisionCount = report.friction.revisionCount;
        props.frictionAutopilot = report.friction.autopilot ? 'true' : 'false';
        props.frictionSafetyTimerFired = report.friction.safetyTimerFired ? 'true' : 'false';
    }
}
