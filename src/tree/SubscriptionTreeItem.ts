/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceManagementClient } from '@azure/arm-resources';
import { IResourceGroupWizardContext, LocationListStep, ResourceGroupCreateStep, ResourceGroupNameStep, SubscriptionTreeItemBase, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzExtParentTreeItem, AzExtTreeItem, AzureWizard, AzureWizardExecuteStep, AzureWizardPromptStep, IActionContext, ICreateChildImplContext, ISubscriptionContext, nonNullOrEmptyValue, nonNullProp, registerEvent } from '@microsoft/vscode-azext-utils';
import { ConfigurationChangeEvent, workspace } from 'vscode';
import { AppResource, AppResourceResolver, GroupableResource } from '../api';
import { applicationResourceProviders } from '../api/registerApplicationResourceProvider';
import { azureResourceProviderId } from '../constants';
import { ext } from '../extensionVariables';
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

        // dynamically generate GroupBy keys, should be moved
        for (const item of this._items) {
            Object.keys(item.groupConfig).forEach(key => {
                if (!ext.groupByKeys[key] && !!item.groupConfig[key].keyLabel) {
                    ext.groupByKeys[key] = <string>item.groupConfig[key].keyLabel;
                }
            });
        }

        await this.refresh(context);
        return <AzExtTreeItem[]>Object.values(this._treeMap);
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
        return new ResourceGroupTreeItem(this, {
            label: nonNullProp(wizardContext, 'newResourceGroupName'),
            id: nonNullOrEmptyValue(nonNullProp(wizardContext, 'resourceGroup').id)
        },
            nonNullProp(wizardContext, 'resourceGroup')
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
        const groupBySetting = <string>settingUtils.getGlobalSetting<string>('groupBy');

        const client: ResourceManagementClient = await createResourceClient([context, this]);
        const resourceGroups = uiUtils.listAllIterator(client.resourceGroups.list());

        for await (const rgTree of this._items) {
            (<AppResourceTreeItem>rgTree).mapSubGroupConfigTree(context, groupBySetting, resourceGroups);
        }
    }

    public getSubConfigGroupTreeItem(id: string): GroupTreeItemBase {
        return this._treeMap[id];
    }

    public setSubConfigGroupTreeItem(id: string, treeItem: GroupTreeItemBase): void {
        this._treeMap[id] = treeItem;
    }

    public async resolveVisibleChildren(context: IActionContext, resolver: AppResourceResolver): Promise<void> {
        const children = Object.values(this._treeMap);
        const childPromises = children.map(c => c.resolveVisibleChildren(context, resolver));

        await Promise.all(childPromises);
    }
}
