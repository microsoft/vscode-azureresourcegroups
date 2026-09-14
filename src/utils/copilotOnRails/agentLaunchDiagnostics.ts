/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { v4 as uuidv4 } from 'uuid';
import { ext } from '../../extensionVariables';
import {
    acknowledgeLatestAgentLaunch,
    appendAgentLaunch,
    type AgentLaunchAcknowledgement,
    type AgentLaunchDiagnostic,
    type NewAgentLaunchDiagnostic,
} from './agentLaunchRecord';

const agentLaunchesKey = 'copilotOnRails.agentLaunches';
let launchUpdateQueue: Promise<void> = Promise.resolve();

export { agentLaunchProtocolVersion } from './agentLaunchRecord';
export type { AgentLaunchDiagnostic } from './agentLaunchRecord';

export function getAgentLaunchDiagnostics(): AgentLaunchDiagnostic[] {
    return ext.context.workspaceState.get<AgentLaunchDiagnostic[]>(agentLaunchesKey, []);
}

function updateAgentLaunches<T>(update: () => Promise<T>): Promise<T> {
    const result = launchUpdateQueue.then(update, update);
    launchUpdateQueue = result.then(() => undefined, () => undefined);
    return result;
}

export async function recordAgentLaunchAttempt(launch: NewAgentLaunchDiagnostic): Promise<AgentLaunchDiagnostic> {
    return await updateAgentLaunches(async () => {
        const launches = appendAgentLaunch(getAgentLaunchDiagnostics(), launch, uuidv4(), new Date().toISOString());
        await ext.context.workspaceState.update(agentLaunchesKey, launches);
        return launches[launches.length - 1];
    });
}

export async function recordChatOpenCommandOutcome(id: string, outcome: 'completed' | 'error'): Promise<void> {
    await updateAgentLaunches(async () => {
        const launches = getAgentLaunchDiagnostics();
        const index = launches.findIndex((launch) => launch.id === id);
        if (index === -1) {
            return;
        }

        const updated = [...launches];
        updated[index] = { ...launches[index], chatOpenCommandOutcome: outcome };
        await ext.context.workspaceState.update(agentLaunchesKey, updated);
    });
}

export async function recordAgentLaunchAcknowledgement(acknowledgement: AgentLaunchAcknowledgement): Promise<AgentLaunchDiagnostic | undefined> {
    return await updateAgentLaunches(async () => {
        const result = acknowledgeLatestAgentLaunch(getAgentLaunchDiagnostics(), acknowledgement, new Date().toISOString());
        if (!result.acknowledgedLaunch) {
            return undefined;
        }

        await ext.context.workspaceState.update(agentLaunchesKey, result.launches);
        return result.acknowledgedLaunch;
    });
}
