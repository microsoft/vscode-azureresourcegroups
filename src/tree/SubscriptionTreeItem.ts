/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IResourceGroupWizardContext, LocationListStep, ResourceGroupCreateStep, ResourceGroupNameStep, SubscriptionTreeItemBase } from '@microsoft/vscode-azext-azureutils';
import { AzExtParentTreeItem, AzExtTreeItem, AzureWizard, AzureWizardExecuteStep, AzureWizardPromptStep, IActionContext, ICreateChildImplContext, ISubscriptionContext, nonNullProp, registerEvent } from '@microsoft/vscode-azext-utils';
import { ConfigurationChangeEvent, workspace } from 'vscode';
import { GroupableApplicationResource } from '../api';
import { ext } from '../extensionVariables';
import { localize } from '../utils/localize';
import { settingUtils } from '../utils/settingUtils';
import { GroupTreeItemBase } from './GroupTreeItemBase';
import { ResourceGroupTreeItem } from './ResourceGroupTreeItem';
import { ResourceTreeItem } from './ResourceTreeItem';

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
    public readonly childTypeLabel: string = localize('resourceGroup', 'Resource Group');

    private _nextLink: string | undefined;
    private _items: GroupableApplicationResource[] = [];
    private _treeMap: { [key: string]: GroupTreeItemBase } = {};

    public constructor(parent: AzExtParentTreeItem, subscription: ISubscriptionContext) {
        super(parent, subscription);
        this.registerRefreshEvents('groupBy')
    }

    public hasMoreChildrenImpl(): boolean {
        return !!this._nextLink;
    }

    public async loadMoreChildrenImpl(clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        if (clearCache) {
            this._items = [];
        }

        this._items = this._items.concat((await ext.resourceProviders['ms-azuretools.vscode-azureresourcegroups'].provideResources(context, this)) || []);
        for (const item of this._items) {
            Object.keys(item.subGroupConfig).forEach(key => {
                if (!ext.groupByKeys[key]) {
                    ext.groupByKeys[key] = item.subGroupConfig[key].name;
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
        return new ResourceGroupTreeItem(this, nonNullProp(wizardContext, 'newResourceGroupName'), nonNullProp(wizardContext, 'resourceGroup'));
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
        this._items.forEach(rgTree => (<ResourceTreeItem>rgTree).mapSubGroupConfigTree(context, groupBySetting))
    }

    public getSubConfigGroupTreeItem(id: string): GroupTreeItemBase {
        return this._treeMap[id];
    }

    public setSubConfigGroupTreeItem(id: string, treeItem: GroupTreeItemBase): void {
        this._treeMap[id] = treeItem;
    }
}
