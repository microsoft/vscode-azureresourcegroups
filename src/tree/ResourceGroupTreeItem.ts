/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroup } from "@azure/arm-resources";
import { AzExtParentTreeItem, AzExtTreeItem, AzureWizard, IActionContext, nonNullProp, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { FileChangeType } from "vscode";
import { GroupNodeConfiguration } from "../api";
import { DeleteResourceGroupContext } from "../commands/deleteResourceGroup/DeleteResourceGroupContext";
import { DeleteResourceGroupStep } from "../commands/deleteResourceGroup/DeleteResourceGroupStep";
import { ext } from "../extensionVariables";
import { createActivityContext } from "../utils/activityUtils";
import { localize } from "../utils/localize";
import { treeUtils } from "../utils/treeUtils";
import { GroupTreeItemBase } from "./GroupTreeItemBase";

export class ResourceGroupTreeItem extends GroupTreeItemBase {
    public static contextValue: string = 'azureResourceGroup';

    public async getData(): Promise<ResourceGroup | undefined> {
        return await this.getResourceGroup(this.name);
    }

    private data?: ResourceGroup;

    constructor(parent: AzExtParentTreeItem, config: GroupNodeConfiguration, private readonly getResourceGroup: (resourceGroup: string) => Promise<ResourceGroup | undefined>) {
        super(parent, config);

        void this.getResourceGroup(this.name).then((rg) => {
            this.data = rg;
        });

        ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this });
    }

    public static createFromResourceGroup(parent: AzExtParentTreeItem, rg: ResourceGroup): ResourceGroupTreeItem {
        return new ResourceGroupTreeItem(parent,
            {
                label: nonNullProp(rg, 'name'),
                id: nonNullProp(rg, 'id'),

            },
            async () => rg);
    }

    public get contextValue(): string {
        return ResourceGroupTreeItem.contextValue
    }

    public get id(): string {
        return this.data ? nonNullProp(this.data, 'id') : `${this.parent?.id}/${this.name}`
    }

    public get name(): string {
        return this.label;
    }

    public get iconPath(): TreeItemIconPath {
        return treeUtils.getIconPath('resourceGroup');
    }

    public async getNumOfResources(context: IActionContext): Promise<number> {
        // load/retrieve the first batch to check if there are more children
        let resources = await this.getCachedChildren(context);

        if (this.hasMoreChildrenImpl()) {
            resources = await this.loadAllChildren(context);
        }

        return resources.length;
    }

    public async refreshImpl(): Promise<void> {
        ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this });
        this.mTime = Date.now();
    }

    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        const wizard = new AzureWizard<DeleteResourceGroupContext>({
            subscription: this.subscription,
            resourceGroupToDelete: this.name,
            activityTitle: localize('deleteResourceGroup', 'Delete resource group "{0}"', this.name),
            ...(await createActivityContext()),
            ...context,
        }, {
            executeSteps: [new DeleteResourceGroupStep()]
        });

        await wizard.execute();
    }

    public compareChildrenImpl(item1: AzExtTreeItem, item2: AzExtTreeItem): number {
        if ((item1 as AzExtParentTreeItem).loadMoreChildrenImpl && (item2 as AzExtParentTreeItem).loadMoreChildrenImpl) {
            return super.compareChildrenImpl(item1, item2);
        } else if ((item1 as AzExtParentTreeItem).loadMoreChildrenImpl) {
            return -1;
        } else if ((item2 as AzExtParentTreeItem).loadMoreChildrenImpl) {
            return 1;
        } else {
            return super.compareChildrenImpl(item1, item2);
        }
    }
}
