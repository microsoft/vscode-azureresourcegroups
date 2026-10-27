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

export function normalizeTreeId(id: string, armResourceId?: string): string {
    if (!armResourceId) {
        return id.toLowerCase();
    }

    const identityPrefix = id.match(/^\/accounts\/[^/]+\/tenants\/[^/]+(?=\/)/i)?.[0] ?? '';
    const resourceId = id.slice(identityPrefix.length);
    // The enumerated ARM ID defines the boundary, including nested and extension resources.
    const armLength = isResourceAncestor(armResourceId, resourceId) ? armResourceId.length : 0;
    const boundary = identityPrefix.length + armLength;
    return id.slice(0, boundary).toLowerCase() + id.slice(boundary);
}

export function isResourceAncestor(resourceId: string, targetId: string): boolean {
    return targetId.slice(0, resourceId.length).toLowerCase() === resourceId.toLowerCase()
        && (targetId.length === resourceId.length || targetId[resourceId.length] === '/');
}
