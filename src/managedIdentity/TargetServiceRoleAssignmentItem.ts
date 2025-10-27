/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { Identity } from "@azure/arm-msi";
import { createRoleDefinitionsItems } from "@microsoft/vscode-azext-azureutils";
import { callWithTelemetryAndErrorHandling, IActionContext, ISubscriptionContext, TreeElementBase } from "@microsoft/vscode-azext-utils";
import { AzureSubscription } from "@microsoft/vscode-azureresources-api";
import { l10n, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ext } from "../extensionVariables";

export class TargetServiceRoleAssignmentItem implements TreeElementBase {
    public id: string;
    public label: string = l10n.t('Target services');
    private _cachedChildren: TreeElementBase[] = [];
    private _loadedAllSubscriptions; // used to determine whether or not to load roles from all subs

    public contextValue: string = 'targetServiceRoleAssignmentItem';

    constructor(readonly subscription: AzureSubscription | ISubscriptionContext, readonly msi: Identity) {
        this.id = `${msi.id}/${this.label}`;
        this._loadedAllSubscriptions = false;
    }

    async getChildren(): Promise<TreeElementBase[]> {
        return await callWithTelemetryAndErrorHandling('TargetServiceRoleAssignmentItem.getChildren', async (context: IActionContext) => {
            const children = await createRoleDefinitionsItems(context, this.subscription, this.msi, this.subscription.subscriptionId);

            if (this._loadedAllSubscriptions) {
                // filter out this sub since it's already loaded
                const subscriptions = (await (await ext.subscriptionProviderFactory()).getAvailableSubscriptions({ all: true })).filter(s => s.subscriptionId !== this.subscription.subscriptionId);
                await Promise.allSettled(subscriptions.map(async (subscription) => {
                    children.push(...await createRoleDefinitionsItems(context, subscription, this.msi, this.subscription.subscriptionId));
                }));
            }

            this._cachedChildren = children;
            return children;
        }) || [];
    }

    getTreeItem(): TreeItem {
        return {
            label: this.label,
            id: this.id,
            contextValue: this.contextValue,
            collapsibleState: this._cachedChildren.length < 10 ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
        }
    }

    setAllSubscriptionsLoaded() {
        this._loadedAllSubscriptions = true;
        this.contextValue = this.contextValue + 'allLoaded';
    }
}
