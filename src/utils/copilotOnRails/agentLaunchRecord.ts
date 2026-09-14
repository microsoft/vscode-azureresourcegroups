/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LocalHarnessSettingDiagnostic } from '../../webviews/copilotOnRails/extension/harnessSettings';

const maxAgentLaunches = 20;

export type ChatOpenCommandOutcome = 'pending' | 'completed' | 'error';

export interface AgentLaunchAcknowledgement {
    agentName: string;
    harness: string;
}

export interface AgentLaunchDiagnostic {
    id: string;
    expectedAgent: string;
    attemptedAt: string;
    chatOpenCommandOutcome: ChatOpenCommandOutcome;
    expectedModel?: string;
    vscodeVersion: string;
    extensionVersion: string;
    copilotChatVersion: string;
    harnessSettings: LocalHarnessSettingDiagnostic[];
    acknowledgedAt?: string;
    reportedAgent?: string;
    agentMatched?: boolean;
    reportedHarness?: string;
}

export type NewAgentLaunchDiagnostic = Omit<AgentLaunchDiagnostic, 'id' | 'attemptedAt' | 'chatOpenCommandOutcome'>;

export function appendAgentLaunch(
    launches: readonly AgentLaunchDiagnostic[],
    launch: NewAgentLaunchDiagnostic,
    id: string,
    attemptedAt: string,
): AgentLaunchDiagnostic[] {
    const record: AgentLaunchDiagnostic = {
        ...launch,
        id,
        attemptedAt,
        chatOpenCommandOutcome: 'pending',
    };
    return [...launches, record].slice(-maxAgentLaunches);
}

export function acknowledgeLatestAgentLaunch(
    launches: readonly AgentLaunchDiagnostic[],
    acknowledgement: AgentLaunchAcknowledgement,
    acknowledgedAt: string,
): { launches: AgentLaunchDiagnostic[]; acknowledgedLaunch?: AgentLaunchDiagnostic } {
    let index = -1;
    for (let candidate = launches.length - 1; candidate >= 0; candidate--) {
        if (!launches[candidate].acknowledgedAt) {
            index = candidate;
            break;
        }
    }
    if (index === -1) {
        return { launches: [...launches] };
    }

    const current = launches[index];
    const acknowledgedLaunch: AgentLaunchDiagnostic = {
        ...current,
        acknowledgedAt,
        reportedAgent: acknowledgement.agentName,
        agentMatched: current.expectedAgent === acknowledgement.agentName,
        reportedHarness: acknowledgement.harness,
    };
    const updated = [...launches];
    updated[index] = acknowledgedLaunch;
    return { launches: updated, acknowledgedLaunch };
}
