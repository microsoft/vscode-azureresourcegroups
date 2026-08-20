/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LocationListStep } from "@microsoft/vscode-azext-azureutils";
import { callWithTelemetryAndErrorHandling, createSubscriptionContext, type IActionContext } from "@microsoft/vscode-azext-utils";
import { ext } from "../../../../extensionVariables";
import { corId } from "../../../../utils/copilotOnRails/telemetryUtils";
import { type AzureLocationOption } from "../../views/utils/deploymentPlanTypes";

/**
 * Lists the regions the given subscription can deploy to, read live from ARM. Returns `undefined`
 * when the user isn't signed in or the call fails; the view then falls back to offering only the
 * region the plan already targets, so the plan still renders offline.
 *
 * Region availability is per-subscription, so the user's first available subscription is used.
 */
export async function getAvailableAzureLocations(): Promise<AzureLocationOption[] | undefined> {
    try {
        const provider = await ext.subscriptionProviderFactory();
        const [subscription] = await provider.getAvailableSubscriptions({ filter: false });
        if (!subscription) {
            return undefined;
        }

        return await callWithTelemetryAndErrorHandling(corId('getDeploymentPlanLocations'), async (actionContext: IActionContext) => {
            actionContext.errorHandling.suppressDisplay = true;
            actionContext.telemetry.suppressIfSuccessful = true;

            const locations = await LocationListStep.getLocations({
                ...actionContext,
                ...createSubscriptionContext(subscription),
            });

            // Logical regions (e.g. `global`) aren't valid deployment targets for a plan.
            const options = locations
                .filter(location => !!location.name && location.metadata?.regionType !== 'Logical')
                .map(location => ({ name: location.displayName ?? location.name, code: location.name }))
                .sort((a, b) => a.name.localeCompare(b.name));

            return options.length > 0 ? options : undefined;
        });
    } catch {
        return undefined;
    }
}
