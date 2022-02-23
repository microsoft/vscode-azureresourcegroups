/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResource } from '@azure/arm-resources';
import { IResourceGroupWizardContext, LocationListStep, ResourceGroupCreateStep, ResourceGroupNameStep, SubscriptionTreeItemBase } from '@microsoft/vscode-azext-azureutils';
import { AzExtParentTreeItem, AzExtTreeItem, AzureWizard, AzureWizardExecuteStep, AzureWizardPromptStep, IActionContext, ICreateChildImplContext, ISubscriptionContext, nonNullProp, registerEvent } from '@microsoft/vscode-azext-utils';
import { ConfigurationChangeEvent, workspace } from 'vscode';
import { GroupableResource, ResolvableTreeItem } from '../api';
import { applicationResourceProviders } from '../api/registerApplicationResourceProvider';
import { AzExtWrapper, getAzureExtensions } from '../AzExtWrapper';
import { ext } from '../extensionVariables';
import { localize } from '../utils/localize';
import { settingUtils } from '../utils/settingUtils';
import { GroupTreeItemBase } from './GroupTreeItemBase';
import { ResourceGroupTreeItem } from './ResourceGroupTreeItem';
import { ResourceTreeItem } from './ResourceTreeItem';
import { ShallowResourceTreeItem } from './ShallowResourceTreeItem';

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
    public readonly childTypeLabel: string = localize('resourceGroup', 'Resource Group');

    private _nextLink: string | undefined;
    private _items: GroupableResource[] = [];
    private _treeMap: { [key: string]: GroupTreeItemBase } = {};

    private resolvables: Record<string, ResolvableTreeItem> = {};
    private rgsItem: GenericResource[] = [];


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
            this.rgsItem.push(...(await applicationResourceProviders[0]?.provideResources(this.subscription) ?? []));
        }

        // await Promise.all(applicationResourceProviders.map((provider: ApplicationResourceProvider) => async () => this.rgsItem.push(...(await provider.provideResources(this.subscription) ?? []))));

        this._items = this.rgsItem.map((resource: GenericResource) => {
            const azExts = getAzureExtensions();
            if (azExts.find((ext: AzExtWrapper) => ext.matchesResourceType(resource))) {
                const resourceId = nonNullProp(resource, 'id');
                if (!this.resolvables[resourceId]) {
                    const resolvable = ResourceTreeItem.Create(this, resource);
                    this.resolvables[resourceId] ??= resolvable;
                    return resolvable;
                }
                return this.resolvables[resourceId];
            } else {
                return new ShallowResourceTreeItem(this, resource);
            }
        });

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
        return new ResourceGroupTreeItem(this, nonNullProp(wizardContext, 'resourceGroup'));
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
        this._items.forEach(rgTree => void (<ResourceTreeItem>rgTree).mapSubGroupConfigTree(context, groupBySetting))
    }

    public getSubConfigGroupTreeItem(id: string): GroupTreeItemBase {
        return this._treeMap[id];
    }

    public setSubConfigGroupTreeItem(id: string, treeItem: GroupTreeItemBase): void {
        this._treeMap[id] = treeItem;
    }
}
