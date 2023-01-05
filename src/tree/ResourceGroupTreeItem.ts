/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroup, ResourceManagementClient } from "@azure/arm-resources";
import { AzExtParentTreeItem, AzureWizard, IActionContext, nonNullProp, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { GroupNodeConfiguration } from "@microsoft/vscode-azext-utils/hostapi";
import { DeleteResourceGroupContext } from "../commands/deleteResourceGroup/DeleteResourceGroupContext";
import { DeleteResourceGroupStep } from "../commands/deleteResourceGroup/DeleteResourceGroupStep";
import { createActivityContext } from "../utils/activityUtils";
import { createResourceClient } from "../utils/azureClients";
import { localize } from "../utils/localize";
import { treeUtils } from "../utils/treeUtils";
import { GroupTreeItemBase } from "./GroupTreeItemBase";

export class ResourceGroupTreeItem extends GroupTreeItemBase {
    public static contextValue: string = 'azureResourceGroup';

    public async getData(): Promise<ResourceGroup | undefined> {
        return this.data || await this.getResourceGroup(this.name);
    }

    private data?: ResourceGroup;

    protected internalContextValuesToAdd: string[] = [ResourceGroupTreeItem.contextValue];

    constructor(parent: AzExtParentTreeItem, config: GroupNodeConfiguration, private readonly getResourceGroup: (resourceGroup: string) => Promise<ResourceGroup | undefined>) {
        super(parent, config);

        void this.getResourceGroup(this.name).then((rg) => {
            this.data = rg;
        });

        // ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this });
    }

    public static createFromResourceGroup(parent: AzExtParentTreeItem, rg: ResourceGroup): ResourceGroupTreeItem {
        return new ResourceGroupTreeItem(parent,
            {
                label: nonNullProp(rg, 'name'),
                id: nonNullProp(rg, 'id'),

            },
            async () => rg);
    }

    public get id(): string {
        return this.data ? nonNullProp(this.data, 'id') : `${this.parent?.id}/${this.name}`
    }

    public get location(): string {
        return this.data ? this.data.location : 'unknown';
    }

    public get name(): string {
        return this.label;
    }

    public get iconPath(): TreeItemIconPath {
        return treeUtils.getIconPath('resourceGroup');
    }

    public async refreshImpl(context: IActionContext): Promise<void> {
        const client: ResourceManagementClient = await createResourceClient([context, this.subscription]);
        this.data = await client.resourceGroups.get(this.name);
        this.mTime = Date.now();
        // ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this });
        await super.refreshImpl(context);
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
}
