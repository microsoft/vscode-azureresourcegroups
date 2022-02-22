/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResource } from '@azure/arm-resources';
import { ResourceManagementClient } from '@azure/arm-resources-profile-2020-09-01-hybrid';
import { createAzureClient, IResourceGroupWizardContext, LocationListStep, ResourceGroupCreateStep, ResourceGroupNameStep, SubscriptionTreeItemBase } from '@microsoft/vscode-azext-azureutils';
import { AzExtParentTreeItem, AzExtTreeItem, AzureWizard, AzureWizardExecuteStep, AzureWizardPromptStep, IActionContext, ICreateChildImplContext, ISubscriptionContext, nonNullProp } from '@microsoft/vscode-azext-utils';
import { applicationResourceProviders } from '../api/registerApplicationResourceProvider';
import { localize } from '../utils/localize';
import { settingUtils } from '../utils/settingUtils';
import { ResolvableTreeItem } from './ResolvableTreeItem';
import { ResourceGroupTreeItem } from './ResourceGroupTreeItem';
import { ResourceTreeItem } from './ResourceTreeItem';
import { ResourceTypeGroupTreeItem } from './ResourceTypeGroupTreeItem';

const resolvables: Record<string, ResolvableTreeItem> = {};
let rgsItem: GenericResource[] = [];

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
            rgsItem = [];
        }

        const client: ResourceManagementClient = createAzureClient([context, this], ResourceManagementClient);
        if (rgsItem.length === 0) {
            rgsItem.push(...(await applicationResourceProviders[0]?.provideResources(this.subscription) ?? []));
        }
        // await Promise.all(applicationResourceProviders.map((provider: ApplicationResourceProvider) => async () => rgsItem.push(...(await provider.provideResources(this.subscription) ?? []))));

        const proxyItems = rgsItem.map((resource: GenericResource) => {
            const resourceId = nonNullProp(resource, 'id');
            if (!resolvables[resourceId]) {
                const resolvable = ResourceTreeItem.Create(this, resource);
                resolvables[resourceId] ??= resolvable;
                return resolvable;
            }
            return resolvables[resourceId];
        });

        // move this code to somewhere to only update the UI otherwise we'll have to load all the children again
        const treeMap: { [key: string]: AzExtParentTreeItem | number } = {};
        // eslint-disable-next-line no-constant-condition
        if (settingUtils.getGlobalSetting<string>('groupBy') === 'Resource Types') {
            for (const rg of proxyItems) {
                if (!treeMap[rg.groupConfig.resourceType.label]) {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    const tree = new ResourceTypeGroupTreeItem(this, rg.groupConfig.resourceType.label);
                    treeMap[rg.groupConfig.resourceType.label] = tree;
                    this._items.push(tree);
                }

                (<ResourceTypeGroupTreeItem>treeMap[rg.groupConfig.resourceType.label]).items.push(rg);
            }
        } else {
            for (const rg of proxyItems) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                if (!treeMap[rg.groupConfig.resourceGroup.id!]) {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    treeMap[rg.groupConfig.resourceGroup.id!] = 0;
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

            for (const rg of proxyItems) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                (<ResourceGroupTreeItem>treeMap[rg.groupConfig.resourceGroup.id!]).items.push(rg);
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
