/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, GenericTreeItem, IActionContext, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { GroupNodeConfiguration } from "@microsoft/vscode-azext-utils/hostapi";
import { ext } from "../extensionVariables";
import { localize } from "../utils/localize";
import { settingUtils } from "../utils/settingUtils";
import { treeUtils } from "../utils/treeUtils";
import { AppResourceTreeItem } from "./AppResourceTreeItem";
import { ResolvableTreeItemBase } from "./ResolvableTreeItemBase";

export class GroupTreeItemBase extends AzExtParentTreeItem {
    public static contextValue = 'group';
    public readonly childTypeLabel: string = localize('resource', 'Resource');
    public treeMap: { [key: string]: ResolvableTreeItemBase } = {};
    public config: GroupNodeConfiguration;

    protected internalContextValuesToAdd: string[] = []

    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    private _showAllResources: boolean = false;

    constructor(parent: AzExtParentTreeItem, config: GroupNodeConfiguration) {
        super(parent);
        this.config = config;
    }

    public get id(): string {
        return this.config.id;
    }

    public get label(): string {
        return this.config.label;
    }

    public get contextValue(): string {
        const focusedGroup = ext.context.workspaceState.get<string>('focusedGroup');
        const contextValues = [...this.config.contextValuesToAdd ?? [], ...this.internalContextValuesToAdd, GroupTreeItemBase.contextValue];
        if (focusedGroup?.toLowerCase() === this.id.toLowerCase()) {
            contextValues.push('focused');
        } else {
            contextValues.push('unfocused')
        }
        return Array.from(new Set(contextValues)).sort().join(';');
    }

    public get description(): string | undefined {
        return this.config.description;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        if (clearCache) {
            // this.treeMap = {};
        }

        let resources = Object.values(this.treeMap) as AzExtTreeItem[];
        const allResources = Object.values(this.treeMap) as AzExtTreeItem[];

        const showHiddenTypes = settingUtils.getWorkspaceSetting('showHiddenTypes') as boolean;
        if (!showHiddenTypes) {
            if (!this._showAllResources) {
                resources = GroupTreeItemBase.filterResources(resources as AppResourceTreeItem[]);
            }

            if (resources.length !== allResources.length || this._showAllResources) {
                resources.push(this.createToggleShowAllResourcesTreeItem(resources.length, Object.keys(this.treeMap).length));
            }
        }

        return resources;
    }

    public get iconPath(): TreeItemIconPath | undefined {
        return this.config.icon ?? this.config.iconPath ?? treeUtils.getIconPath('resource');
    }

    public hasChildren(): boolean {
        return !!Object.values(this.treeMap).length;
    }

    public static filterResources(resources: AppResourceTreeItem[]): AppResourceTreeItem[] {
        return resources.filter(r => !r.isHidden);
    }

    public compareChildrenImpl(item1: AppResourceTreeItem, item2: AppResourceTreeItem): number {
        const showHiddenTypes = settingUtils.getWorkspaceSetting('showHiddenTypes') as boolean;
        // if showHiddenTypes is off, then these should be pushed below toggleShowAllResourcesTreeItem
        if (!showHiddenTypes) {
            if (item1.isHidden && item2.isHidden) {
                return super.compareChildrenImpl(item1, item2);
            } else if (item1.isHidden) {
                return 1;
            } else if (item2.isHidden) {
                return -1;
            }

            if (item1 instanceof GenericTreeItem) {
                return 1;
            } else if (item2 instanceof GenericTreeItem) {
                return -1;
            }
        }

        return super.compareChildrenImpl(item1, item2);
    }

    public async toggleShowAllResources(context: IActionContext): Promise<void> {
        this._showAllResources = !this._showAllResources;
        await this.refresh(context);
    }

    public async resolveAllChildrenOnExpanded(context: IActionContext): Promise<void> {
        await Promise.all(
            Object.values(this.treeMap).map(async resolvable => resolvable.resolve(false, context))
        );
    }

    private createToggleShowAllResourcesTreeItem(numOfResources: number, numOfTotalResources: number): GenericTreeItem {
        const label = !this._showAllResources ?
            localize('showingResources', 'Showing {0} of {1} resources. Click to reveal all resources.', numOfResources, numOfTotalResources) :
            localize('hideAllResources', 'Click to hide filtered resources.');

        const toggleShowAllResourcesTreeItem = new GenericTreeItem(this, {
            label,
            contextValue: 'showAllResourcesTree',
            commandId: 'azureResourceGroups.toggleShowAllResources',
        });

        toggleShowAllResourcesTreeItem.commandArgs = [this];

        return toggleShowAllResourcesTreeItem;
    }
}
