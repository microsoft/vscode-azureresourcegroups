/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroup } from "@azure/arm-resources";
import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, nonNullProp, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { AppResource, GroupableResource, GroupingConfig, GroupNodeConfiguration } from "@microsoft/vscode-azext-utils/hostapi";
import { FileChangeType } from "vscode";
import { azureExtensions } from "../azureExtensions";
import { GroupBySettings } from "../commands/explorer/groupBy";
import { ungroupedId } from "../constants";
import { ext } from "../extensionVariables";
import { createGroupConfigFromResource, getIconPath } from "../utils/azureUtils";
import { settingUtils } from "../utils/settingUtils";
import { GroupTreeItemBase } from "./GroupTreeItemBase";
import { ResolvableTreeItemBase } from "./ResolvableTreeItemBase";
import { GroupTreeMap } from "./ResourceCache";
import { ResourceGroupTreeItem } from "./ResourceGroupTreeItem";
import { SubscriptionTreeItem } from "./SubscriptionTreeItem";

export class AppResourceTreeItem extends ResolvableTreeItemBase implements GroupableResource, AppResource {
    public static contextValue: string = 'azureResource';

    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    public rootGroupTreeItem: AzExtParentTreeItem;
    public rootGroupConfig: GroupNodeConfiguration;
    public groupConfig: GroupingConfig;

    public type: string;
    public kind?: string | undefined;
    public location?: string | undefined;
    public tags?: { [propertyName: string]: string; } | undefined;

    public isHidden: boolean;

    private constructor(root: AzExtParentTreeItem, resource: AppResource) {
        super(root);
        this.rootGroupTreeItem = root;
        this.rootGroupConfig = <GroupNodeConfiguration><unknown>root;

        this.data = resource;
        this.groupConfig = createGroupConfigFromResource(resource, root.id);

        this.contextValues.add(AppResourceTreeItem.contextValue);
        ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this });

        this.type = resource.type;
        this.kind = resource.kind;
        this.location = resource.location;
        this.tags = resource.tags;

        this.isHidden = !azureExtensions.some(ext =>
            ext.resourceTypes.some((type) => {
                return typeof type === 'string' ?
                    type.toLowerCase() === this.type?.toLowerCase() :
                    type.name.toLowerCase() === this.type?.toLowerCase() && type.matchesResource(this.data)
            }));
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

    public get fullId(): string {
        return `${this.parent?.id}${this.id}`;
    }

    public get label(): string {
        return this.name;
    }

    public get iconPath(): TreeItemIconPath {
        return getIconPath(this.data.type, this.data.kind);
    }

    public get parent(): GroupTreeItemBase | undefined {
        const groupBySetting = <string>settingUtils.getWorkspaceSetting<string>('groupBy');
        const configId: string | undefined = this.groupConfig[groupBySetting]?.id.toLowerCase() ?? `${this.rootGroupConfig.id}/${ungroupedId}`;

        return (<SubscriptionTreeItem>this.rootGroupTreeItem).treeMap[configId];
    }

    public set parent(_node: GroupTreeItemBase | undefined) {
        // do nothing as we only want to return parent dynamically
    }

    public async refreshImpl(context: IActionContext): Promise<void> {
        this.mTime = Date.now();
        ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this });
        await super.refreshImpl(context);
    }

    public mapSubGroupConfigTree(context: IActionContext,
        groupBySetting: string,
        treeMap: GroupTreeMap,
        getResourceGroup: (resourceGroup: string) => Promise<ResourceGroup | undefined>): void {

        const configId: string | undefined = this.groupConfig[groupBySetting]?.id.toLowerCase() ?? `${this.rootGroupConfig.id}/${ungroupedId}`;
        let subGroupTreeItem = treeMap[configId];
        if (!subGroupTreeItem) {
            subGroupTreeItem = this.createSubGroupTreeItem(context, groupBySetting, getResourceGroup);
            treeMap[configId] = subGroupTreeItem;
        }

        subGroupTreeItem.treeMap[this.id] = this;
        void ext.appResourceTree.refreshUIOnly(subGroupTreeItem);
    }

    public createSubGroupTreeItem(_context: IActionContext, groupBySetting: string, getResourceGroup: (resourceGroup: string) => Promise<ResourceGroup | undefined>): GroupTreeItemBase {
        switch (groupBySetting) {
            case GroupBySettings.ResourceGroup:
                return new ResourceGroupTreeItem(this.rootGroupTreeItem, this.groupConfig.resourceGroup, getResourceGroup);
            default:
                return new GroupTreeItemBase(this.rootGroupTreeItem, this.groupConfig[groupBySetting]);
        }
    }
}


