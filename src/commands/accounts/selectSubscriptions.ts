/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { AzureSubscription } from '../../../api/src/index';
import { ext } from "../../extensionVariables";

export async function selectSubscriptions(_context: IActionContext): Promise<void> {
    const results = await ext.subscriptionProvider.getSubscriptions();

    if (results.status === 'LoggedIn') {

        const subscriptionQuickPickItems: (vscode.QuickPickItem & { subscription: AzureSubscription })[] =
            results
                .allSubscriptions
                .map(subscription => ({
                    label: subscription.name,
                    picked: results.filters.includes(subscription),
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
            await ext.subscriptionProvider.selectSubscriptions(
                picks.length < results.allSubscriptions.length
                    ? picks.map(pick => pick.subscription.subscriptionId)
                    : undefined);
        }
    }
}
