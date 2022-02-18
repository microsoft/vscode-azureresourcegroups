/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Resource, ResourceManagementClient } from '@azure/arm-resources';
import { IResourceGroupWizardContext, LocationListStep, ResourceGroupCreateStep, ResourceGroupNameStep, SubscriptionTreeItemBase, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzExtParentTreeItem, AzExtTreeItem, AzureWizard, AzureWizardExecuteStep, AzureWizardPromptStep, IActionContext, ICreateChildImplContext, ISubscriptionContext, nonNullProp } from '@microsoft/vscode-azext-utils';
import { createResourceClient } from '../utils/azureClients';
import { localize } from '../utils/localize';
import { settingUtils } from '../utils/settingUtils';
import { ResourceGroupTreeItem } from './ResourceGroupTreeItem';
import { ResourceTreeItem } from './ResourceTreeItem';
import { ResourceTypeGroupTreeItem } from './ResourceTypeGroupTreeItem';

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
    public readonly childTypeLabel: string = localize('resourceGroup', 'Resource Group');

    private _nextLink: string | undefined;
    private _items: AzExtTreeItem[];

    public constructor(parent: AzExtParentTreeItem, subscription: ISubscriptionContext) {
        super(parent, subscription);
        this._items = [];
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

        const rgs: Resource[] = await uiUtils.listAllIterator(client.resources.list());
        const rgsItem: ResourceTreeItem[] = <ResourceTreeItem[]>await this.createTreeItemsWithErrorHandling(
            rgs,
            'invalidResource',
            rg => new ResourceTreeItem(this, rg),
            rg => rg.name
        );

        // move this code to somewhere to only update the UI otherwise we'll have to load all the children again
        const treeMap: { [key: string]: AzExtTreeItem | number } = {};
        // eslint-disable-next-line no-constant-condition
        if (settingUtils.getGlobalSetting<string>('groupBy') === 'Resource Types') {
            for (const rg of rgsItem) {
                if (!treeMap[rg.subGroupConfig.resourceType.label]) {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    const tree = new ResourceTypeGroupTreeItem(this, rg.subGroupConfig.resourceType.label);
                    treeMap[rg.subGroupConfig.resourceType.label] = tree;
                    this._items.push(tree);
                }

                (<ResourceTypeGroupTreeItem>treeMap[rg.subGroupConfig.resourceType.label]).items.push(rg);
            }
        } else {
            for (const rg of rgsItem) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                if (!treeMap[rg.subGroupConfig.resourceGroup.id!]) {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    treeMap[rg.subGroupConfig.resourceGroup.id!] = 0;
                }
            }

            await Promise.all(Object.keys(treeMap).map(async id => {
                if (!treeMap[id]) {
                    const group = await client.resourceGroups.get(id.split('/')[4]);
                    const rgTree = new ResourceGroupTreeItem(this, group);
                    treeMap[id] = rgTree;
                    this._items.push(rgTree);
                }
            }));

            for (const rg of rgsItem) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                (<ResourceGroupTreeItem>treeMap[rg.subGroupConfig.resourceGroup.id!]).items.push(rg);
            }
        }

        return <AzExtTreeItem[]>Object.values(treeMap);
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<AzExtTreeItem> {
        const wizardContext: IResourceGroupWizardContext = { ...context, ...this.subscription, suppress403Handling: true };

        const title: string = localize('createResourceGroup', 'Create Resource Group');
        const promptSteps: AzureWizardPromptStep<IResourceGroupWizardContext>[] = [new ResourceGroupNameStep()];
        LocationListStep.addStep(wizardContext, promptSteps);
        const executeSteps: AzureWizardExecuteStep<IResourceGroupWizardContext>[] = [new ResourceGroupCreateStep()];

        const wizard: AzureWizard<IResourceGroupWizardContext> = new AzureWizard(wizardContext, { title, promptSteps, executeSteps });
        await wizard.prompt();
        context.showCreatingTreeItem(nonNullProp(wizardContext, 'newResourceGroupName'));
        await wizard.execute();
        return new ResourceGroupTreeItem(this, nonNullProp(wizardContext, 'resourceGroup'));
    }
}
