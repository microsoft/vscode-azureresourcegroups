/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from '@microsoft/vscode-azext-utils';
import { ResourceTreeOperationContext } from '../../api/src';

export interface TreeTraversalContext extends ResourceTreeOperationContext {
    targetId?: string;
}

/**
 * Retains an explicit operation's original failure even when telemetry consumes cancellation.
 * No resource identifiers or error contents are added to telemetry by this helper.
 */
export async function callWithTreeErrorHandling<T>(
    event: string,
    callback: (context: IActionContext) => T | Promise<T>,
    options?: ResourceTreeOperationContext
): Promise<T | undefined> {
    let failure: { error: unknown } | undefined;
    const result = await callWithTelemetryAndErrorHandling(event, async context => {
        if (options?.propagateErrors) {
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.suppressReportIssue = true;
        }
        try {
            return await callback(context);
        } catch (error) {
            if (options?.propagateErrors) {
                failure = { error };
            }
            throw error;
        }
    });
    if (failure) {
        throw failure.error;
    }
    return result;
}

export function normalizeTreeId(id: string): string {
    // ARM and account/tenant IDs are case-insensitive; provider child IDs after the ARM resource are not.
    return id.replace(
        /^(?:\/accounts\/[^/]+\/tenants\/[^/]+)?\/subscriptions\/[^/]+(?:\/resourceGroups\/[^/]+)?(?:\/providers\/[^/]+\/[^/]+\/[^/]+)?/i,
        prefix => prefix.toLowerCase());
}

export function isResourceAncestor(resourceId: string, targetId: string): boolean {
    return targetId.slice(0, resourceId.length).toLowerCase() === resourceId.toLowerCase()
        && (targetId.length === resourceId.length || targetId[resourceId.length] === '/');
}
