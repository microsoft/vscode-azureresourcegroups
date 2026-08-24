/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isNotSignedInError } from "@microsoft/vscode-azext-azureauth";
import { LocationListStep } from "@microsoft/vscode-azext-azureutils";
import { callWithTelemetryAndErrorHandling, createSubscriptionContext, type IActionContext } from "@microsoft/vscode-azext-utils";
import { ext } from "../../../../extensionVariables";
import { corId } from "../../../../utils/copilotOnRails/telemetryUtils";
import { type AzureLocationOption } from "../../views/utils/deploymentPlanTypes";

/**
 * Why the region picker has no options, so the view can say so instead of silently degrading to a
 * read-only region code.
 */
export type AzureLocationsResult =
    | { status: 'loaded'; locations: AzureLocationOption[] }
    /** No Azure account is signed in, or the account has no subscriptions. */
    | { status: 'signedOut' }
    /** Signed in, but ARM couldn't be reached or returned nothing usable. */
    | { status: 'failed' };

/**
 * Lists the regions the given subscription can deploy to, read live from ARM. On failure the view
 * falls back to showing only the region the plan already targets, so the plan still renders offline.
 *
 * Region availability is per-subscription, so the user's first available subscription is used.
 */
export async function getAvailableAzureLocations(): Promise<AzureLocationsResult> {
    try {
        const provider = await ext.subscriptionProviderFactory();
        const [subscription] = await provider.getAvailableSubscriptions({ filter: false });
        if (!subscription) {
            return { status: 'signedOut' };
        }

        const options = await callWithTelemetryAndErrorHandling(corId('getDeploymentPlanLocations'), async (actionContext: IActionContext) => {
            actionContext.errorHandling.suppressDisplay = true;
            actionContext.telemetry.suppressIfSuccessful = true;

            const locations = await LocationListStep.getLocations({
                ...actionContext,
                ...createSubscriptionContext(subscription),
            });

            // Logical regions (e.g. `global`) aren't valid deployment targets for a plan.
            return locations
                .filter(location => !!location.name && location.metadata?.regionType !== 'Logical')
                .map(location => ({ name: location.displayName ?? location.name, code: location.name }))
                .sort((a, b) => a.name.localeCompare(b.name));
        });

        return options && options.length > 0 ? { status: 'loaded', locations: options } : { status: 'failed' };
    } catch (error) {
        // `getAvailableSubscriptions` throws NotSignedInError rather than returning an empty array
        // when no Azure account is signed in, so the signed-out case arrives here, not above.
        return { status: isNotSignedInError(error) ? 'signedOut' : 'failed' };
    }
}
