/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Resource, ResourceManagementClient } from '@azure/arm-resources';
import { IResourceGroupWizardContext, LocationListStep, ResourceGroupCreateStep, ResourceGroupNameStep, SubscriptionTreeItemBase, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzExtParentTreeItem, AzExtTreeItem, AzureWizard, AzureWizardExecuteStep, AzureWizardPromptStep, IActionContext, ICreateChildImplContext, ISubscriptionContext, nonNullProp, registerEvent } from '@microsoft/vscode-azext-utils';
import { ConfigurationChangeEvent, workspace } from 'vscode';
import { ext } from '../extensionVariables';
import { createResourceClient } from '../utils/azureClients';
import { localize } from '../utils/localize';
import { settingUtils } from '../utils/settingUtils';
import { LocationGroupTreeItem } from './LocationGroupTreeItem';
import { ResourceGroupTreeItem } from './ResourceGroupTreeItem';
import { ResourceTreeItem } from './ResourceTreeItem';
import { ResourceTypeGroupTreeItem } from './ResourceTypeGroupTreeItem';

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
    public readonly childTypeLabel: string = localize('resourceGroup', 'Resource Group');

    private _nextLink: string | undefined;
    private _items: ResourceTreeItem[];
    private _treeMap: { [key: string]: AzExtTreeItem | number } = {};

    public constructor(parent: AzExtParentTreeItem, subscription: ISubscriptionContext) {
        super(parent, subscription);
        this._items = [];
    }

    public hasMoreChildrenImpl(): boolean {
        return !!this._nextLink;
    }

    public async loadMoreChildrenImpl(clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        if (clearCache) {
            this._items = [];
        }

        const client: ResourceManagementClient = await createResourceClient([context, this]);
        // Load more currently broken https://github.com/Azure/azure-sdk-for-js/issues/20380

        const rgs: Resource[] = await uiUtils.listAllIterator(client.resources.list());
        this._items = <ResourceTreeItem[]>await this.createTreeItemsWithErrorHandling(
            rgs,
            'invalidResource',
            rg => new ResourceTreeItem(this, rg),
            rg => rg.name
        );

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
        return new ResourceGroupTreeItem(this, nonNullProp(wizardContext, 'resourceGroup'));
    }

    public registerRefreshEvents(): void {
        registerEvent('treeView.onDidChangeConfiguration', workspace.onDidChangeConfiguration, async (context: IActionContext, e: ConfigurationChangeEvent) => {
            context.errorHandling.suppressDisplay = true;
            context.telemetry.suppressIfSuccessful = true;
            context.telemetry.properties.isActivationEvent = 'true';

            if (e.affectsConfiguration(`${ext.prefix}.groupBy`)) {
                await this.refresh(context);
            }
        });
    }

    public async refreshImpl(context: IActionContext): Promise<void> {
        this._treeMap = {};
        const groupBySetting = settingUtils.getGlobalSetting<string>('groupBy');
        if (groupBySetting === 'Resource Types') {
            for (const rg of this._items) {
                if (!this._treeMap[rg.subGroupConfig.resourceType.label]) {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    const tree = new ResourceTypeGroupTreeItem(this, rg.subGroupConfig.resourceType.label);
                    this._treeMap[rg.subGroupConfig.resourceType.label] = tree;
                }

                (<ResourceTypeGroupTreeItem>this._treeMap[rg.subGroupConfig.resourceType.label]).items.push(rg);
            }
        } else if (groupBySetting === 'Resource Groups') {
            for (const rg of this._items) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                if (!this._treeMap[rg.subGroupConfig.resourceGroup.id!]) {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    this._treeMap[rg.subGroupConfig.resourceGroup.id!] = 0;
                }
            }

            await Promise.all(Object.keys(this._treeMap).map(async id => {
                if (!this._treeMap[id]) {
                    const client: ResourceManagementClient = await createResourceClient([context, this]);
                    const group = await client.resourceGroups.get(id.split('/')[4]);
                    const rgTree = new ResourceGroupTreeItem(this, group);
                    this._treeMap[id] = rgTree;
                }
            }));

            for (const rg of this._items) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                (<ResourceGroupTreeItem>this._treeMap[rg.subGroupConfig.resourceGroup.id!]).items.push(rg);
            }
        } else {
            for (const rg of this._items) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                if (!this._treeMap[rg.data.location!.toLocaleLowerCase()]) {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    const locTree = new LocationGroupTreeItem(this, rg.data.location!.toLocaleLowerCase());
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    this._treeMap[rg.data.location!.toLocaleLowerCase()] = locTree;
                }
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                (<LocationGroupTreeItem>this._treeMap[rg.data.location!.toLocaleLowerCase()]).items.push(rg);
            }
        }
    }
}
