/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroup } from "@azure/arm-resources";
import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, nonNullProp, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { FileChangeType } from "vscode";
import { AppResource, GroupableResource, GroupingConfig, GroupNodeConfiguration } from "../api";
import { ext } from "../extensionVariables";
import { createGroupConfigFromResource, getIconPath } from "../utils/azureUtils";
import { GroupTreeItemBase } from "./GroupTreeItemBase";
import { ResolvableTreeItemBase } from "./ResolvableTreeItemBase";
import { ResourceGroupTreeItem } from "./ResourceGroupTreeItem";
import { SubscriptionTreeItem } from "./SubscriptionTreeItem";

export class AppResourceTreeItem extends ResolvableTreeItemBase implements GroupableResource {
    public static contextValue: string = 'azureResource';

    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    public rootGroupTreeItem: AzExtParentTreeItem;
    public rootGroupConfig: GroupNodeConfiguration;
    public groupConfig: GroupingConfig;
    public parent: GroupTreeItemBase | undefined;

    private constructor(root: AzExtParentTreeItem, resource: AppResource) {
        super(root);
        this.rootGroupTreeItem = root;
        this.rootGroupConfig = <GroupNodeConfiguration><unknown>root;

        this.data = resource;
        this.groupConfig = createGroupConfigFromResource(resource, root.id);

        this.contextValues.add(AppResourceTreeItem.contextValue);
        ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this });
    }

    /**
     * Creates a Proxied app resource tree item
     *
     * @param parent
     * @param resource
     * @returns
     */
    public static Create(parent: AzExtParentTreeItem, resource: AppResource): AppResourceTreeItem {
        const resolvable: AppResourceTreeItem = new AppResourceTreeItem(parent, resource);
        const providerHandler: ProxyHandler<AppResourceTreeItem> = {
            get: (target: AppResourceTreeItem, name: string): unknown => {
                return resolvable?.resolveResult?.[name] ?? target[name];
            },
            set: (target: AppResourceTreeItem, name: string, value: unknown): boolean => {
                if (resolvable.resolveResult && Object.getOwnPropertyDescriptor(resolvable.resolveResult, name)?.writable) {
                    resolvable.resolveResult[name] = value;
                    return true;
                }
                target[name] = value;
                return true;
            },
            /**
             * Needed to be compatible with any usages of instanceof in utils/azureutils
             *
             * If resolved returns AzExtTreeItem or AzExtParentTreeItem depending on if resolveResult has loadMoreChildrenImpl defined
             * If not resolved, returns AppResourceTreeItem
             */
            getPrototypeOf: (target: AppResourceTreeItem): AppResourceTreeItem | AzExtParentTreeItem | AzExtTreeItem => {
                if (resolvable?.resolveResult) {
                    return resolvable.resolveResult.loadMoreChildrenImpl ? AzExtParentTreeItem.prototype : AzExtTreeItem.prototype
                }
                return target;
            }
        }
        return new Proxy(resolvable, providerHandler);
    }

    public get name(): string {
        return nonNullProp(this.data, 'name');
    }

    public get id(): string {
        return nonNullProp(this.data, 'id');
    }

    public get label(): string {
        return this.name;
    }

    public get iconPath(): TreeItemIconPath {
        return getIconPath(this.data.type, this.data.kind);
    }

    public async refreshImpl(): Promise<void> {
        this.mTime = Date.now();
        ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this });
    }

    public mapSubGroupConfigTree(context: IActionContext, groupBySetting: string, resourceGroups: Promise<ResourceGroup[]>): void {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        let subGroupTreeItem = (<SubscriptionTreeItem>this.rootGroupTreeItem).getSubConfigGroupTreeItem(this.groupConfig[groupBySetting].id)
        if (!subGroupTreeItem) {
            subGroupTreeItem = this.createSubGroupTreeItem(context, groupBySetting, resourceGroups);
            (<SubscriptionTreeItem>this.rootGroupTreeItem).setSubConfigGroupTreeItem(this.groupConfig[groupBySetting].id, subGroupTreeItem)
        }

        subGroupTreeItem.treeMap[this.id] = this;
        this.parent = subGroupTreeItem;
        // this should actually be "resolve"
        void subGroupTreeItem.refresh(context);
    }

    public createSubGroupTreeItem(_context: IActionContext, groupBySetting: string, resourceGroups: Promise<ResourceGroup[]>): GroupTreeItemBase {
        switch (groupBySetting) {
            // TODO: Use ResovableTreeItem here
            case 'resourceGroup':
                return new ResourceGroupTreeItem(this.rootGroupTreeItem, this.groupConfig.resourceGroup, resourceGroups);
            default:
                return new GroupTreeItemBase(this.rootGroupTreeItem, this.groupConfig[groupBySetting]);
        }
    }
}


