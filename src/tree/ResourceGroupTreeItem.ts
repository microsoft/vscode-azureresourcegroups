/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroup, ResourceManagementClient } from "@azure/arm-resources";
import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, nonNullProp, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { FileChangeType } from "vscode";
import { GroupNodeConfiguration } from "../api";
import { ext } from "../extensionVariables";
import { createResourceClient } from "../utils/azureClients";
import { localize } from "../utils/localize";
import { treeUtils } from "../utils/treeUtils";
import { GroupTreeItemBase } from "./GroupTreeItemBase";

export class ResourceGroupTreeItem extends GroupTreeItemBase {
    public static contextValue: string = 'azureResourceGroup';

    constructor(parent: AzExtParentTreeItem, config: GroupNodeConfiguration, data: ResourceGroup) {
        super(parent, config);
        this.data = data;

        ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this });
    }

    public get data(): ResourceGroup | undefined {
        return this.data;
    }

    public set data(data: ResourceGroup | undefined) {
        this.data = data;
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

    public get description(): string | undefined {
        const state: string | undefined = this.data?.properties?.provisioningState;
        return state?.toLowerCase() === 'succeeded' ? `${Object.keys(this.treeMap).length} resources` : state;
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

    public async refreshImpl(context: IActionContext): Promise<void> {
        const client: ResourceManagementClient = await createResourceClient([context, this]);
        this.data = await client.resourceGroups.get(this.name);
        ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this });
        this.mTime = Date.now();
    }

    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        const client: ResourceManagementClient = await createResourceClient([context, this]);
        await client.resourceGroups.beginDeleteAndWait(this.name);
        ext.outputChannel.appendLog(localize('deletedRg', 'Successfully deleted resource group "{0}".', this.name));
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
