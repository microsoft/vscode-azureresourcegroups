/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroup, ResourceManagementClient } from '@azure/arm-resources';
import { IResourceGroupWizardContext, LocationListStep, ResourceGroupCreateStep, ResourceGroupNameStep, SubscriptionTreeItemBase, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzExtParentTreeItem, AzExtTreeItem, AzureWizard, AzureWizardExecuteStep, AzureWizardPromptStep, ExecuteActivityContext, IActionContext, IAzureQuickPickOptions, ICreateChildImplContext, ISubscriptionContext, nonNullOrEmptyValue, nonNullProp, registerEvent } from '@microsoft/vscode-azext-utils';
import { AppResource, AppResourceFilter, PickAppResourceOptions } from '@microsoft/vscode-azext-utils/hostapi';
import { ConfigurationChangeEvent, ThemeIcon, workspace } from 'vscode';
import { applicationResourceProviders } from '../api/registerApplicationResourceProvider';
import { GroupBySettings } from '../commands/explorer/groupBy';
import { azureResourceProviderId, ungroupedId } from '../constants';
import { ext } from '../extensionVariables';
import { createActivityContext } from '../utils/activityUtils';
import { createResourceClient } from '../utils/azureClients';
import { createAzureExtensionsGroupConfig, getResourceType } from '../utils/azureUtils';
import { localize } from '../utils/localize';
import { settingUtils } from '../utils/settingUtils';
import { AppResourceTreeItem } from './AppResourceTreeItem';
import { GroupTreeItemBase } from './GroupTreeItemBase';
import { ResourceGroupTreeItem } from './ResourceGroupTreeItem';

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
    public readonly childTypeLabel: string = localize('resourceGroup', 'Resource Group');

    private _triggeredByDefaultGroupBySetting: boolean = false;
    private _triggeredByFocusGroupSetting: boolean = false;

    private cache: {
        resourceGroups: ResourceGroup[];
        nextLink?: string;
        appResources: AppResourceTreeItem[];
        treeMaps: {
            [groupBySetting: string]: {
                [key: string]: GroupTreeItemBase
            }
        }
    }

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
                if (getResourceType(filter.type, filter.kind) === getResourceType(appResource.data.type, appResource.data.kind)) {
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
            .sort((a, b) => a.group.localeCompare(b.group));

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

    private _azExtGroupConfigs = createAzureExtensionsGroupConfig(nonNullProp(this, 'id'));

    private async getResourceGroups(clearCache: boolean, context: IActionContext): Promise<ResourceGroup[]> {
        if (!this.cache.resourceGroups.length || !clearCache) {
            const client: ResourceManagementClient = await createResourceClient([context, this.subscription]);
            this.cache.resourceGroups = await uiUtils.listAllIterator(client.resourceGroups.list());
        }
        return this.cache.resourceGroups;
    }

    private resetCache(): void {
        this.cache = {
            resourceGroups: [],
            appResources: [],
            treeMaps: {}
        }
    }

    public constructor(parent: AzExtParentTreeItem, subscription: ISubscriptionContext) {
        super(parent, subscription);
        this.resetCache();
        this.registerRefreshEvents();
    }

    public hasMoreChildrenImpl(): boolean {
        return !!this.cache.nextLink;
    }

    public async loadMoreChildrenImpl(clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        try {
            const focusedGroupId = await ext.context.workspaceState.get('focusedGroup') as string;
            let focusGroupTreeItem: GroupTreeItemBase | undefined;
            if (this._triggeredByFocusGroupSetting) {
                focusGroupTreeItem = await this.tryGetFocusGroupTreeItem(focusedGroupId);
                if (focusGroupTreeItem) {
                    return [focusGroupTreeItem];
                }
            } else if (!this._triggeredByDefaultGroupBySetting) {
                if (clearCache) {
                    this.resetCache();
                }

                if (this.cache.appResources.length === 0) {
                    const resources = await applicationResourceProviders[azureResourceProviderId]?.provideResources(this.subscription) ?? [];

                    // To support multiple app resource providers, need to use this pattern
                    // await Promise.all(applicationResourceProviders.map((provider: ApplicationResourceProvider) => async () => this.rgsItem.push(...(await provider.provideResources(this.subscription) ?? []))));

                    resources.forEach(item => ext.activationManager.onNodeTypeFetched(item.type));
                    this.cache.appResources = resources.map((resource: AppResource) => AppResourceTreeItem.Create(this, resource));
                }
                await this.createTreeMaps(clearCache, context);

                // on first load, check if there was persistent setting
                focusGroupTreeItem = await this.tryGetFocusGroupTreeItem(focusedGroupId);
                if (focusGroupTreeItem) {
                    return [focusGroupTreeItem];
                }
            }

            let groupTreeItems = Object.values(this.treeMap) as GroupTreeItemBase[];
            if (!settingUtils.getWorkspaceSetting('showHiddenTypes') &&
                settingUtils.getWorkspaceSetting<string>('groupBy') === GroupBySettings.ResourceType) {
                groupTreeItems = groupTreeItems.filter(ti => this._azExtGroupConfigs.some(config => config.id === ti.config.id));
            }

            return groupTreeItems;
        } finally {
            this._triggeredByDefaultGroupBySetting = false;
            this._triggeredByFocusGroupSetting = false;
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
            this._triggeredByFocusGroupSetting = true;
            await this.refresh(context);
        });

        registerEvent('treeView.onDidChangeConfiguration', workspace.onDidChangeConfiguration, async (context: IActionContext, e: ConfigurationChangeEvent) => {
            context.errorHandling.suppressDisplay = true;
            context.telemetry.suppressIfSuccessful = true;
            context.telemetry.properties.isActivationEvent = 'true';

            if (e.affectsConfiguration(`${ext.prefix}.groupBy`) ||
                e.affectsConfiguration(`${ext.prefix}.showHiddenTypes`)) {
                // we can generate the default groups ahead of time so we don't need to refresh the entire tree
                this._triggeredByDefaultGroupBySetting = Object.values(GroupBySettings).includes(settingUtils.getWorkspaceSetting<string>('groupBy') as GroupBySettings);
                // reset the focusedGroup since it won't exist in this grouping
                await ext.context.workspaceState.update('focusedGroup', '');
                await this.refresh(context);
            }
        });
    }

    private async createTreeMaps(clearCache: boolean, context: IActionContext): Promise<void> {
        // start this as early as possible
        const resourceGroupsTask = this.getResourceGroups(clearCache, context);

        const getResourceGroupTask: (resourceGroup: string) => Promise<ResourceGroup | undefined> = async (resourceGroup: string) => {
            return (await resourceGroupsTask).find((rg) => rg.name === resourceGroup);
        };

        const currentGroupBySetting = <string>settingUtils.getWorkspaceSetting<string>('groupBy');
        const groupBySettings = Object.values(GroupBySettings) as string[];
        if (!groupBySettings.includes(currentGroupBySetting)) { groupBySettings.push(currentGroupBySetting); }

        // always create the groups for extensions that we support
        for (const azExtGroupConfig of this._azExtGroupConfigs) {
            const groupTreeItem = new GroupTreeItemBase(this, azExtGroupConfig);
            this.setSubConfigGroupTreeItem(GroupBySettings.ResourceType, azExtGroupConfig.id, groupTreeItem);
        }

        for (const groupBySetting of groupBySettings) {
            this.cache.treeMaps[groupBySetting] ??= {};

            const ungroupedTreeItem = new GroupTreeItemBase(this, {
                label: localize('ungrouped', 'ungrouped'),
                id: `${this.id}/${ungroupedId}`,
                iconPath: new ThemeIcon('json')
            });

            this.cache.treeMaps[groupBySetting][ungroupedTreeItem.id] = ungroupedTreeItem;
            for (const rgTree of this.cache.appResources) {
                (<AppResourceTreeItem>rgTree).mapSubGroupConfigTree(context, groupBySetting, getResourceGroupTask);
            }

            if (!ungroupedTreeItem.hasChildren()) {
                delete this.cache.treeMaps[groupBySetting][ungroupedTreeItem.id];
            }
        }

        // if this isn't resolved by now, we need it to be so that we can retrieve empty RGs
        const resourceGroups = await resourceGroupsTask;
        // only get RGs that are not in the treeMap already
        const emptyResourceGroups = resourceGroups.filter(rg => !this.cache.treeMaps[GroupBySettings.ResourceGroup][rg.id?.toLowerCase() ?? '']);
        for (const eRg of emptyResourceGroups) {
            this.cache.treeMaps[GroupBySettings.ResourceGroup][nonNullProp(eRg, 'id').toLowerCase()] = ResourceGroupTreeItem.createFromResourceGroup(this, eRg);
        }
    }

    public getSubConfigGroupTreeItem(groupBy: string, id: string): GroupTreeItemBase | undefined {
        return this.cache.treeMaps[groupBy]?.[id.toLowerCase()];
    }

    public setSubConfigGroupTreeItem(groupBy: string, id: string, treeItem: GroupTreeItemBase): void {
        this.cache.treeMaps[groupBy] ??= {};
        this.cache.treeMaps[groupBy][id.toLowerCase()] = treeItem;
    }

    public async findAppResourceByResourceId(context: IActionContext, resourceId: string): Promise<AppResourceTreeItem | undefined> {
        await this.getCachedChildren(context) // to ensure the group nodes are loaded
        return this.cache.appResources.find(ar => ar.id === resourceId);
    }

    public compareChildrenImpl(item1: AzExtTreeItem, item2: AzExtTreeItem): number {
        const id = `${this.id}/${ungroupedId}`;
        if (item1.id === id) { return 1; } else if (item2.id === id) { return -1; }

        return super.compareChildrenImpl(item1, item2);
    }

    public get treeMap(): { [key: string]: GroupTreeItemBase } {
        const groupBy = <string>settingUtils.getWorkspaceSetting<string>('groupBy');
        return this.cache.treeMaps[groupBy] ?? {};
    }

    private async tryGetFocusGroupTreeItem(focusedGroupId: string | undefined): Promise<GroupTreeItemBase | undefined> {
        if (focusedGroupId) {
            const focusedGroup = Object.values(this.treeMap).find(group => group.id.toLowerCase() === focusedGroupId?.toLowerCase());
            if (focusedGroup) {
                return focusedGroup;
            }

            // if we can't find it, erase the current setting, return current cached tree
            await ext.context.workspaceState.update('focusedGroup', '');
        }

        return undefined;
    }
}
