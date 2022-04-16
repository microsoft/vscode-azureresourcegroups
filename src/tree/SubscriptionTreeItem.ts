/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroup, ResourceManagementClient } from '@azure/arm-resources';
import { IResourceGroupWizardContext, LocationListStep, ResourceGroupCreateStep, ResourceGroupNameStep, SubscriptionTreeItemBase, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzExtParentTreeItem, AzExtTreeItem, AzureWizard, AzureWizardExecuteStep, AzureWizardPromptStep, ExecuteActivityContext, IActionContext, ICreateChildImplContext, ISubscriptionContext, nonNullOrEmptyValue, nonNullProp, registerEvent } from '@microsoft/vscode-azext-utils';
import { ConfigurationChangeEvent, ThemeIcon, workspace } from 'vscode';
import { AppResource, AppResourceResolver, GroupableResource } from '../api';
import { applicationResourceProviders } from '../api/registerApplicationResourceProvider';
import { GroupBySettings } from '../commands/explorer/groupBy';
import { azureResourceProviderId } from '../constants';
import { ext } from '../extensionVariables';
import { createActivityContext } from '../utils/activityUtils';
import { createResourceClient } from '../utils/azureClients';
import { localize } from '../utils/localize';
import { settingUtils } from '../utils/settingUtils';
import { AppResourceTreeItem } from './AppResourceTreeItem';
import { GroupTreeItemBase } from './GroupTreeItemBase';
import { ResourceGroupTreeItem } from './ResourceGroupTreeItem';

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
    public readonly childTypeLabel: string = localize('resourceGroup', 'Resource Group');

    private _nextLink: string | undefined;
    private _items: GroupableResource[] = [];
    private _treeMap: { [key: string]: GroupTreeItemBase } = {};

    private rgsItem: AppResource[] = [];

    public constructor(parent: AzExtParentTreeItem, subscription: ISubscriptionContext) {
        super(parent, subscription);
        this.registerRefreshEvents('groupBy')
    }

    public hasMoreChildrenImpl(): boolean {
        return !!this._nextLink;
    }

    public async loadMoreChildrenImpl(clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        if (clearCache) {
            this._nextLink = undefined;
            this.rgsItem = [];
        }

        if (this.rgsItem.length === 0) {
            this.rgsItem.push(...(await applicationResourceProviders[azureResourceProviderId]?.provideResources(this.subscription) ?? []));

            // To support multiple app resource providers, need to use this pattern
            // await Promise.all(applicationResourceProviders.map((provider: ApplicationResourceProvider) => async () => this.rgsItem.push(...(await provider.provideResources(this.subscription) ?? []))));

            this.rgsItem.forEach(item => ext.activationManager.onNodeTypeFetched(item.type));
        }

        this._items = this.rgsItem.map((resource: AppResource): GroupableResource => AppResourceTreeItem.Create(this, resource));

        await this.refresh(context);
        return <AzExtTreeItem[]>Object.values(this._treeMap);
    }


    public async createChildImpl(context: ICreateChildImplContext): Promise<AzExtTreeItem> {
        const wizardContext: IResourceGroupWizardContext & ExecuteActivityContext = {
            ...context, ...this.subscription, suppress403Handling: true,
            ...(await createActivityContext()),
        };

        const title: string = localize('createResourceGroup', 'Create Resource Group');
        const promptSteps: AzureWizardPromptStep<IResourceGroupWizardContext>[] = [new ResourceGroupNameStep()];
        LocationListStep.addStep(wizardContext, promptSteps);
        const executeSteps: AzureWizardExecuteStep<IResourceGroupWizardContext>[] = [new ResourceGroupCreateStep()];
        const wizard: AzureWizard<IResourceGroupWizardContext & ExecuteActivityContext> = new AzureWizard(wizardContext, { title, promptSteps, executeSteps });
        await wizard.prompt();
        const newResourceGroupName = nonNullProp(wizardContext, 'newResourceGroupName');
        wizardContext.activityTitle = localize('createResourceGroup', 'Create Resource Group "{0}"', newResourceGroupName);
        context.showCreatingTreeItem(newResourceGroupName);
        await wizard.execute();
        return new ResourceGroupTreeItem(this, {
            label: nonNullProp(wizardContext, 'newResourceGroupName'),
            id: nonNullOrEmptyValue(nonNullProp(wizardContext, 'resourceGroup').id)
        },
            (): Promise<ResourceGroup> => Promise.resolve(nonNullProp(wizardContext, 'resourceGroup'))
        );
    }

    public registerRefreshEvents(key: string): void {
        registerEvent('treeView.onDidChangeConfiguration', workspace.onDidChangeConfiguration, async (context: IActionContext, e: ConfigurationChangeEvent) => {
            context.errorHandling.suppressDisplay = true;
            context.telemetry.suppressIfSuccessful = true;
            context.telemetry.properties.isActivationEvent = 'true';

            if (e.affectsConfiguration(`${ext.prefix}.${key}`)) {
                await this.refresh(context);
            }
        });
    }

    public async refreshImpl(context: IActionContext): Promise<void> {
        this._treeMap = {};
        const ungroupedTreeItem = new GroupTreeItemBase(this, {
            label: localize('ungrouped', 'ungrouped'),
            id: `${this.id}/ungrouped`,
            iconPath: new ThemeIcon('json')
        });

        this._treeMap[ungroupedTreeItem.id] = ungroupedTreeItem;

        const groupBySetting = <string>settingUtils.getWorkspaceSetting<string>('groupBy');
        const client: ResourceManagementClient = await createResourceClient([context, this]);
        const getResourceGroupsTask = uiUtils.listAllIterator(client.resourceGroups.list());

        const getResourceGroupTask: (resourceGroup: string) => Promise<ResourceGroup | undefined> = async (resourceGroup: string) => {
            return (await getResourceGroupsTask).find((rg) => rg.name === resourceGroup);
        };

        for (const rgTree of this._items) {
            (<AppResourceTreeItem>rgTree).mapSubGroupConfigTree(context, groupBySetting, getResourceGroupTask);
        }

        if (groupBySetting === GroupBySettings.ResourceGroup) {
            // if this isn't resolved by now, we need it to be so that we can retrieve empty RGs
            const resourceGroups = await getResourceGroupsTask;
            // only get RGs that are not in the treeMap already
            const emptyResourceGroups = resourceGroups.filter(rg => !this._treeMap[rg.id?.toLowerCase() ?? '']);
            for (const eRg of emptyResourceGroups) {
                this._treeMap[nonNullProp(eRg, 'id').toLowerCase()] = ResourceGroupTreeItem.createFromResourceGroup(this, eRg);
            }
        }

        if (!ungroupedTreeItem.hasChildren()) {
            delete this._treeMap[ungroupedTreeItem.id]
        }
    }

    public getSubConfigGroupTreeItem(id: string): GroupTreeItemBase {
        return this._treeMap[id.toLowerCase()];
    }

    public setSubConfigGroupTreeItem(id: string, treeItem: GroupTreeItemBase): void {
        this._treeMap[id.toLowerCase()] = treeItem;
    }

    public async resolveVisibleChildren(context: IActionContext, resolver: AppResourceResolver): Promise<void> {
        const children = Object.values(this._treeMap);
        const childPromises = children.map(c => c.resolveVisibleChildren(context, resolver));

        await Promise.all(childPromises);
    }

    public compareChildrenImpl(item1: AzExtTreeItem, item2: AzExtTreeItem): number {
        const id = `${this.id}/ungrouped`;
        if (item1.id === id) { return 1; } else if (item2.id === id) { return -1; }

        return super.compareChildrenImpl(item1, item2);
    }
}
