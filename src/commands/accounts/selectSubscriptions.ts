/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzureSubscription } from "@microsoft/vscode-azext-azureauth";
import { IActionContext, IAzureQuickPickItem } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";
import { settingUtils } from "../../utils/settingUtils";

export async function selectSubscriptions(context: IActionContext): Promise<void> {
    const provider = await ext.subscriptionProviderFactory();
    if (await provider.isSignedIn()) {

        const selectedSubscriptionIds = await getSelectedSubscriptionIds();
        const subscriptionQuickPickItems: () => Promise<IAzureQuickPickItem<AzureSubscription>[]> = async () => {
            // If there are no tenants selected by default all subscriptions will be shown.
            const allSubscriptions = await provider.getSubscriptions(false);

            const duplicates = getDuplicateSubscriptions(allSubscriptions);

            const tenantFilteredSubcriptions = getTenantFilteredSubscriptions(allSubscriptions);
            if (tenantFilteredSubcriptions) {
                return tenantFilteredSubcriptions
                    .map(subscription => ({
                        label: duplicates.includes(subscription) ? subscription.name + ` (${subscription.account?.label})` : subscription.name,
                        description: subscription.subscriptionId,
                        data: subscription
                    }))
                    .sort((a, b) => a.label.localeCompare(b.label));
            }

            return allSubscriptions
                .map(subscription => ({
                    label: duplicates.includes(subscription) ? subscription.name + ` (${subscription.account?.label})` : subscription.name,
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

// This function is also used to filter subscription tree items in AzureResourceTreeDataProvider
export function getTenantFilteredSubscriptions(allSubscriptions: AzureSubscription[]): AzureSubscription[] | undefined {
    const tenants = ext.context.globalState.get<string[]>('unselectedTenants');
    if (tenants && tenants.length > 0) {
        allSubscriptions = allSubscriptions.filter(subscription => !tenants.includes(`${subscription.tenantId}/${subscription.account?.id}`));
        if (allSubscriptions.length > 0) {
            return allSubscriptions;
        }
    }

    return undefined;
}

export function getDuplicateSubscriptions(subscriptions: AzureSubscription[]): AzureSubscription[] {
    const lookup = subscriptions.reduce((accumulator, sub) => {
        accumulator[sub.subscriptionId] = ++accumulator[sub.subscriptionId] || 0;
        return accumulator;
    }, {} as Record<string, number>);

    return subscriptions.filter(sub => lookup[sub.subscriptionId]);
}
