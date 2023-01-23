/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { AzureSubscription, AzureSubscriptionProvider, AzureSubscriptionStatus } from "../../services/AzureSubscriptionProvider";

export async function selectSubscriptions(_context: IActionContext, subscriptionProvider: AzureSubscriptionProvider): Promise<void> {
    const results = await subscriptionProvider.getSubscriptions();

    if (results.status === AzureSubscriptionStatus.LoggedIn) {

        const subscriptionQuickPickItems: (vscode.QuickPickItem & { subscription: AzureSubscription })[] =
            results
                .allSubscriptions
                .map(subscription => ({
                    label: subscription.displayName,
                    picked: results.selectedSubscriptions.includes(subscription),
                    subscription
                }))
                .sort((a, b) => a.label.localeCompare(b.label));

        const picks = await vscode.window.showQuickPick(
            subscriptionQuickPickItems,
            {
                canPickMany: true,
                placeHolder: 'Select Subscriptions'
            });

        if (picks) {
            await subscriptionProvider.selectSubscriptions(
                picks.length < results.allSubscriptions.length
                    ? picks.map(pick => pick.subscription.id)
                    : undefined);
        }
    }
}
