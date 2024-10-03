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

export interface SelectSubscriptionOptions {
    /**
     * If provided, only subscriptions in this tenant will be shown in the picker. Only subscriptions shown in the picker will be removed or added to the selected subscriptions setting.
     */
    tenantId?: string;
    /**
     * TODO: implement filtering at the account level
     */
    account?: vscode.AuthenticationSessionAccountInformation;
}

export async function selectSubscriptions(context: IActionContext, options?: SelectSubscriptionOptions): Promise<void> {
    const provider = await ext.subscriptionProviderFactory();
    if (await provider.isSignedIn()) {

        const selectedSubscriptionsWithFullId = await getSelectedTenantAndSubscriptionIds();
        const selectedSubscriptionIds = selectedSubscriptionsWithFullId.map(id => id.split('/')[1]);

        let subscriptionsShownInPicker: string[] = [];

        const subscriptionQuickPickItems: () => Promise<IAzureQuickPickItem<AzureSubscription>[]> = async () => {

            const allSubscriptions = await provider.getSubscriptions(false);
            const subscriptionsFilteredByTenant = options?.tenantId ? allSubscriptions.filter(subscription => subscription.tenantId === options.tenantId) : allSubscriptions;

            subscriptionsShownInPicker = subscriptionsFilteredByTenant.map(sub => `${sub.tenantId}/${sub.subscriptionId}`);
            return subscriptionsFilteredByTenant
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
            // get previously selected subscriptions
            const previouslySelectedSubscriptionsSettingValue = new Set(selectedSubscriptionsWithFullId);

            // remove any that were shown in the picker
            subscriptionsShownInPicker.forEach(pick => previouslySelectedSubscriptionsSettingValue.delete(pick));

            // add any that were selected in the picker
            picks.forEach(pick => previouslySelectedSubscriptionsSettingValue.add(`${pick.data.tenantId}/${pick.data.subscriptionId}`));

            // update the setting
            await setSelectedTenantAndSubscriptionIds(Array.from(previouslySelectedSubscriptionsSettingValue));
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
