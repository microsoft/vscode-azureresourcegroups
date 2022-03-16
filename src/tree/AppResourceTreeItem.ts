/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, IActionContext, nonNullProp, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { FileChangeType } from "vscode";
import { AppResource, GroupableResource, GroupingConfig, GroupNodeConfiguration, ResolvedAppResourceBase } from "../api";
import { ext } from "../extensionVariables";
import { createGroupConfigFromResource, getIconPath } from "../utils/azureUtils";
import { GroupTreeItemBase } from "./GroupTreeItemBase";
import { ResolvableTreeItemBase } from "./ResolvableTreeItemBase";
import { SubscriptionTreeItem } from "./SubscriptionTreeItem";

export class AppResourceTreeItem extends ResolvableTreeItemBase implements GroupableResource {
    public static contextValue: string = 'azureResource';

    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    public rootGroupTreeItem: AzExtParentTreeItem;
    public rootGroupConfig: GroupNodeConfiguration;
    public groupConfig: GroupingConfig;

    private constructor(parent: AzExtParentTreeItem, resource: AppResource) {
        // parent should be renamed to rootGroup
        super(parent);
        this.rootGroupTreeItem = parent;
        this.rootGroupConfig = <GroupNodeConfiguration><unknown>parent;

        this.data = resource;
        this.groupConfig = createGroupConfigFromResource(resource, parent.id);

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
            getPrototypeOf: (target: AppResourceTreeItem): AppResourceTreeItem | ResolvedAppResourceBase => {
                return resolvable?.resolveResult ?? target;
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
        return getIconPath(this.data.type);
    }

    public async refreshImpl(): Promise<void> {
        this.mTime = Date.now();
        ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this });
    }

    public mapSubGroupConfigTree(context: IActionContext, groupBySetting: string): void {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        let subGroupTreeItem = (<SubscriptionTreeItem>this.rootGroupTreeItem).getSubConfigGroupTreeItem(this.groupConfig[groupBySetting].id)
        if (!subGroupTreeItem) {
            subGroupTreeItem = this.createSubGroupTreeItem(context, groupBySetting);
            (<SubscriptionTreeItem>this.rootGroupTreeItem).setSubConfigGroupTreeItem(this.groupConfig[groupBySetting].id, subGroupTreeItem)
        }

        subGroupTreeItem.treeMap[this.id] = this;
        // this should actually be "resolve"
        void subGroupTreeItem.refresh(context);
    }

    public createSubGroupTreeItem(_context: IActionContext, groupBySetting: string): GroupTreeItemBase {
        // const client = await createResourceClient([context, this.rootGroupTreeItem.subscription]);
        switch (groupBySetting) {
            case 'resourceType':
                return new GroupTreeItemBase(this.rootGroupTreeItem, this.groupConfig.resourceType);
            // case 'resourceGroup':
            // TODO: Use ResovableTreeItem here
            // return new ResourceGroupTreeItem(this.rootGroupTreeItem, (await client.resourceGroups.get(this.groupConfig.resourceGroup.label)));
            default:
                return new GroupTreeItemBase(this.rootGroupTreeItem, this.groupConfig['location']);
        }
    }
}


