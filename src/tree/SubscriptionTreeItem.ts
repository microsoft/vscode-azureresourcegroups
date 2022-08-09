/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroup, ResourceManagementClient } from '@azure/arm-resources';
import { IResourceGroupWizardContext, LocationListStep, ResourceGroupCreateStep, ResourceGroupNameStep, SubscriptionTreeItemBase, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzExtParentTreeItem, AzExtTreeItem, AzureWizard, AzureWizardExecuteStep, AzureWizardPromptStep, ExecuteActivityContext, getAzExtResourceType, IActionContext, IAzureQuickPickItem, IAzureQuickPickOptions, ICreateChildImplContext, ISubscriptionContext, nonNullOrEmptyValue, nonNullProp, NoResourceFoundError, registerEvent } from '@microsoft/vscode-azext-utils';
import { AppResourceFilter, PickAppResourceOptions } from '@microsoft/vscode-azext-utils/hostapi';
import { ConfigurationChangeEvent, workspace } from 'vscode';
import { applicationResourceProviders } from '../api/registerApplicationResourceProvider';
import { GroupBySettings } from '../commands/explorer/groupBy';
import { azureResourceProviderId, ungroupedId } from '../constants';
import { ext } from '../extensionVariables';
import { createActivityContext } from '../utils/activityUtils';
import { createResourceClient } from '../utils/azureClients';
import { localize } from '../utils/localize';
import { settingUtils } from '../utils/settingUtils';
import { AppResourceTreeItem } from './AppResourceTreeItem';
import { GroupTreeItemBase } from './GroupTreeItemBase';
import { GroupTreeMap, ResourceCache } from './ResourceCache';
import { ResourceGroupTreeItem } from './ResourceGroupTreeItem';

interface PickResourceGroupOptions {
    canPickMany?: boolean;
    placeholder?: string;
}

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
    public readonly childTypeLabel: string = localize('resourceGroup', 'Resource Group');
    public treeMap: GroupTreeMap = {}


    private cache: ResourceCache = new ResourceCache(this);

    public async pickAppResource(context: IActionContext, options?: PickAppResourceOptions): Promise<AppResourceTreeItem> {
        await this.getCachedChildren(context);

        let appResources = this.cache.appResources;
        const showHiddenTypes = settingUtils.getWorkspaceSetting<boolean>('showHiddenTypes');
        if (!showHiddenTypes) {
            appResources = GroupTreeItemBase.filterResources(this.cache.appResources);
        }

        if (options?.filter) {
            const filters: AppResourceFilter[] = Array.isArray(options.filter) ? options.filter : [options.filter];
            appResources = appResources.filter((appResource) => filters.some(filter => {
                if (getAzExtResourceType(filter) === getAzExtResourceType(appResource)) {
                    if (filter.tags) {
                        return Object.entries(filter.tags).every(([tag, value]) => appResource.tags?.[tag] === value);
                    }
                    return true;
                }
                return false;
            }));
        }

        // If requested, resolve the `AppResourceTreeItem`s now
        if (options?.resolveQuickPicksBeforeDisplay) {
            await Promise.all(
                appResources.map(async appResource => appResource.resolve(false, context))
            );
        }

        const picks = appResources.map((appResource) => ({ data: appResource, label: appResource.label, group: appResource.groupConfig.resourceType.label, description: appResource.groupConfig.resourceGroup.label }))
            .sort((a, b) => a.label.localeCompare(b.label))
            .sort((a, b) => a.group.localeCompare(b.group));

        if (picks.length === 0) {
            throw new NoResourceFoundError();
        }

        const quickPickOptions: IAzureQuickPickOptions = {
            enableGrouping: !options?.filter,
            placeHolder: localize('selectResource', 'Select a resource'),
            ...options,
        };

        const result = await context.ui.showQuickPick(picks, quickPickOptions);

        // If not resolved yet, resolve now
        // Internally, `resolve` will noop if it is already resolved
        await result.data.resolve(false, context);

        return result.data;
    }

    public async pickResourceGroup(context: IActionContext, options: PickResourceGroupOptions & { canPickMany: true }): Promise<ResourceGroupTreeItem[]>;
    public async pickResourceGroup(context: IActionContext, options: PickResourceGroupOptions & { canPickMany: false }): Promise<ResourceGroupTreeItem>;
    public async pickResourceGroup(context: IActionContext, options: PickResourceGroupOptions): Promise<ResourceGroupTreeItem | ResourceGroupTreeItem[]> {
        if (this.cache.resourceGroups.length === 0) {
            const client: ResourceManagementClient = await createResourceClient([context, this.subscription]);
            this.cache.resourceGroups = await uiUtils.listAllIterator(client.resourceGroups.list());
        }

        const quickPicks: IAzureQuickPickItem<ResourceGroupTreeItem>[] = this.cache.resourceGroups.sort((a, b) => a.name.localeCompare(b.name)).map((rg: ResourceGroupTreeItem): IAzureQuickPickItem<ResourceGroupTreeItem> => ({
            data: rg,
            label: nonNullProp(rg, 'name')
        }));

        if (quickPicks.length === 0) {
            throw new NoResourceFoundError();
        }

        const tis = (await context.ui.showQuickPick(quickPicks, {
            canPickMany: options.canPickMany,
            placeHolder: options.placeholder || localize('selectResourceGroup', 'Select a resource group'),
        }));

        if (Array.isArray(tis)) {
            return (tis as IAzureQuickPickItem<ResourceGroupTreeItem>[]).map((ti) => ti.data);
        } else {
            return (tis as IAzureQuickPickItem<ResourceGroupTreeItem>).data;
        }
    }

    private async resolveResourceGroupsIfNeeded(context: IActionContext): Promise<void> {
        if (<string>settingUtils.getWorkspaceSetting<string>('groupBy') === GroupBySettings.ResourceGroup) {
            const client: ResourceManagementClient = await createResourceClient([context, this.subscription]);
            this.cache.resourceGroups = await uiUtils.listAllIterator(client.resourceGroups.list());
        }
    }

    public constructor(parent: AzExtParentTreeItem, subscription: ISubscriptionContext) {
        super(parent, subscription);
        this.registerRefreshEvents();
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        const resources = await applicationResourceProviders[azureResourceProviderId]?.provideResources(this.subscription) ?? [];

        // To support multiple app resource providers, need to use this pattern
        // await Promise.all(applicationResourceProviders.map((provider: ApplicationResourceProvider) => async () => this.rgsItem.push(...(await provider.provideResources(this.subscription) ?? []))));
        resources.forEach(item => ext.activationManager.onNodeTypeFetched(item.type));
        this.cache.appResources = resources;

        await this.resolveResourceGroupsIfNeeded(context);
        this.treeMap = this.cache.getTreeMap(context);

        // on first load, check if there was persistent setting
        const focusGroupTreeItem = await this.tryGetFocusGroupTreeItem();
        if (focusGroupTreeItem) {
            return [focusGroupTreeItem];
        }

        return Object.values(this.treeMap);
    }

    public async refreshImpl(context: IActionContext): Promise<void> {
        for (const ti of Object.values(this.treeMap)) {
            void ti.refresh(context);
        }
    }


    public async createChildImpl(context: ICreateChildImplContext): Promise<ResourceGroupTreeItem> {
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

    public registerRefreshEvents(): void {
        registerEvent('treeView.onDidChangeFocusedGroup', ext.events.onDidChangeFocusedGroup, async (context: IActionContext) => {
            context.errorHandling.suppressDisplay = true;
            context.telemetry.suppressIfSuccessful = true;
            context.telemetry.properties.isActivationEvent = 'true';
            const groupTreeItem = await this.tryGetFocusGroupTreeItem();
            this._setCachedChildren(groupTreeItem ? [groupTreeItem] : Object.values(this.treeMap));
        });

        registerEvent('treeView.onDidChangeConfiguration', workspace.onDidChangeConfiguration, async (context: IActionContext, e: ConfigurationChangeEvent) => {
            context.errorHandling.suppressDisplay = true;
            context.telemetry.suppressIfSuccessful = true;
            context.telemetry.properties.isActivationEvent = 'true';

            if (e.affectsConfiguration(`${ext.prefix}.groupBy`) ||
                e.affectsConfiguration(`${ext.prefix}.showHiddenTypes`)) {
                // reset the focusedGroup since it won't exist in this grouping
                await ext.context.workspaceState.update('focusedGroup', '');
                await this.refresh(context);
            }
        });
    }

    public async findAppResourceByResourceId(context: IActionContext, resourceId: string): Promise<AppResourceTreeItem | undefined> {
        await this.getCachedChildren(context) // to ensure the group nodes are loaded
        return this.cache.appResources.find(ar => ar.id.toLowerCase() === resourceId.toLowerCase());
    }

    public compareChildrenImpl(item1: AzExtTreeItem, item2: AzExtTreeItem): number {
        const id = `${this.id}/${ungroupedId}`;
        if (item1.id === id) { return 1; } else if (item2.id === id) { return -1; }

        return super.compareChildrenImpl(item1, item2);
    }

    private _setCachedChildren(childrenToSet: AzExtTreeItem[]): void {
        // To access the private cacheChildren, go buckwild and ignore typings!!
        const thisUnknown = this as unknown as { _cachedChildren: AzExtTreeItem[] };
        thisUnknown._cachedChildren = childrenToSet;
        thisUnknown._cachedChildren = childrenToSet.sort((ti1, ti2) => this.compareChildrenImpl(ti1, ti2));

        // To prevent "Element with id {0} is already registered" errors, we must
        // clear VS Code's internal cache by passing `undefined` to refresh the whole tree
        this.treeDataProvider.refreshUIOnly(undefined);
    }

    private async tryGetFocusGroupTreeItem(): Promise<GroupTreeItemBase | undefined> {
        const focusedGroupId = await ext.context.workspaceState.get('focusedGroup') as string;
        if (focusedGroupId) {
            const focusedGroup = this.treeMap[focusedGroupId.toLowerCase()];
            if (focusedGroup) {
                return focusedGroup;
            }
        }

        return undefined;
    }
}
