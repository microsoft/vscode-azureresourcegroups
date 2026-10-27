/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class AgentLaunchReportTracker {
    private readonly startedReports = new Set<string>();

    public tryStart(sessionId: string, agentName: string): boolean {
        const key = this.getKey(sessionId, agentName);
        if (this.startedReports.has(key)) {
            return false;
        }

        this.startedReports.add(key);
        return true;
    }

    public markFailed(sessionId: string, agentName: string): void {
        this.startedReports.delete(this.getKey(sessionId, agentName));
    }

    private getKey(sessionId: string, agentName: string): string {
        return JSON.stringify([sessionId, agentName]);
    }
}
