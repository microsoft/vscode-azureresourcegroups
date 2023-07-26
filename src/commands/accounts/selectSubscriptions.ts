/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext, IAzureQuickPickItem } from "@microsoft/vscode-azext-utils";
import { AzureSubscription } from "api/src/resources/azure";
import * as vscode from "vscode";
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";
import { settingUtils } from "../../utils/settingUtils";

export async function selectSubscriptions(context: IActionContext): Promise<void> {
    const provider = await ext.subscriptionProviderFactory();
    if (await provider.isSignedIn()) {

        const selectedSubscriptionIds = await getSelectedSubscriptionIds();
        const subscriptionQuickPickItems: () => Promise<IAzureQuickPickItem<AzureSubscription>[]> = async () => {

            const allSubscriptions = await provider.getSubscriptions(false);

            return allSubscriptions
                .map(subscription => ({
                    label: subscription.name,
                    description: subscription.subscriptionId,
                    data: subscription
                }))
                .sort((a, b) => a.label.localeCompare(b.label));
        }

        const picks = await context.ui.showQuickPick(
            subscriptionQuickPickItems(),
            {
                isPickSelected: (pick) => {
                    return selectedSubscriptionIds.length === 0 || selectedSubscriptionIds.includes((pick as IAzureQuickPickItem<AzureSubscription>).data.subscriptionId);
                },
                canPickMany: true,
                placeHolder: localize('selectSubscriptions', 'Select Subscriptions')
            });

        if (picks) {
            await setSelectedTenantAndSubscriptionIds(picks.map(s => `${s.data.tenantId}/${s.data.subscriptionId}`));
        }

        ext.actions.refreshAzureTree();
    } else {
        const signIn: vscode.MessageItem = { title: localize('signIn', 'Sign In') };
        void vscode.window.showInformationMessage(localize('notSignedIn', 'You are not signed in. Sign in to continue.'), signIn).then((input) => {
            if (input === signIn) {
                void provider.signIn();
            }
        });
    }
}

async function getSelectedSubscriptionIds(): Promise<string[]> {
    const selectedTenantAndSubscriptionIds = await getSelectedTenantAndSubscriptionIds();
    return selectedTenantAndSubscriptionIds.map(id => id.split('/')[1]);
}

export async function getSelectedTenantAndSubscriptionIds(): Promise<string[]> {
    // clear setting value if there's a value that doesn't include the tenant id
    // see https://github.com/microsoft/vscode-azureresourcegroups/pull/684
    const selectedSubscriptionIds = settingUtils.getGlobalSetting<string[] | undefined>('selectedSubscriptions') ?? [];
    if (selectedSubscriptionIds?.some(id => !id.includes('/'))) {
        await setSelectedTenantAndSubscriptionIds([]);
        return [];
    }

    return selectedSubscriptionIds;
}

async function setSelectedTenantAndSubscriptionIds(tenantAndSubscriptionIds: string[]): Promise<void> {
    await settingUtils.updateGlobalSetting('selectedSubscriptions', tenantAndSubscriptionIds);
}
