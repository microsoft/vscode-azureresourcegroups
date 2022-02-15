/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResourceExpanded, ResourceGroup, ResourceManagementClient } from "@azure/arm-resources";
import { uiUtils } from "@microsoft/vscode-azext-azureutils";
import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, nonNullProp, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { FileChangeType } from "vscode";
import { ext } from "../extensionVariables";
import { createResourceClient } from "../utils/azureClients";
import { localize } from "../utils/localize";
import { settingUtils } from "../utils/settingUtils";
import { treeUtils } from "../utils/treeUtils";
import { ResourceTreeItem } from "./ResourceTreeItem";

export class ResourceGroupTreeItem extends AzExtParentTreeItem {
    public static contextValue: string = 'azureResourceGroup';
    public readonly contextValue: string = ResourceGroupTreeItem.contextValue;
    public readonly childTypeLabel: string = localize('resource', 'Resource');
    public data: ResourceGroup;
    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    private _nextLink: string | undefined;

    constructor(parent: AzExtParentTreeItem, rg: ResourceGroup) {
        super(parent);
        this.data = rg;
        ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this });
    }

    public get name(): string {
        return nonNullProp(this.data, 'name');
    }

    public get id(): string {
        return nonNullProp(this.data, 'id');
    }

    public get label(): string {
        return this.name;
    }

    public get description(): string | undefined {
        const state: string | undefined = this.data.properties?.provisioningState;
        return state?.toLowerCase() === 'succeeded' ? undefined : state;
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

    public hasMoreChildrenImpl(): boolean {
        return !!this._nextLink;
    }

    public async loadMoreChildrenImpl(clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        if (clearCache) {
            this._nextLink = undefined;
        }

        const client: ResourceManagementClient = await createResourceClient([context, this]);
        // Load more currently broken https://github.com/Azure/azure-sdk-for-js/issues/20380
        const resources: GenericResourceExpanded[] = await uiUtils.listAllIterator(client.resources.listByResourceGroup(this.name));
        return await this.createTreeItemsWithErrorHandling(
            resources,
            'invalidResource',
            resource => {
                const hiddenTypes: string[] = [
                    'microsoft.alertsmanagement/smartdetectoralertrules',
                    'microsoft.insights/actiongroups',
                    'microsoft.security/automations'
                ];

                if (settingUtils.getWorkspaceSetting<boolean>('showHiddenTypes') || (resource.type && !hiddenTypes.includes(resource.type.toLowerCase()))) {
                    return new ResourceTreeItem(this, resource);
                } else {
                    return undefined;
                }
            },
            resource => resource.name
        );
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
}
