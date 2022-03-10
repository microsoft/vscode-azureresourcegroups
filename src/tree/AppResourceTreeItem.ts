/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, IActionContext, nonNullProp, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import * as path from 'path';
import { FileChangeType } from "vscode";
import { AppResource, GroupableResource, GroupingConfig, GroupNodeConfiguration, ResolvedAppResourceBase } from "../api";
import { ext } from "../extensionVariables";
import { createGroupConfigFromResource } from "../utils/azureUtils";
import { treeUtils } from "../utils/treeUtils";
import { GroupTreeItemBase } from "./GroupTreeItemBase";
import { LocationGroupTreeItem } from "./LocationGroupTreeItem";
import { ResolvableTreeItemBase } from "./ResolvableTreeItemBase";
import { ResourceTypeGroupTreeItem } from "./ResourceTypeGroupTreeItem";
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
        this.commandId = 'azureResourceGroups.revealResource';
        this.groupConfig = createGroupConfigFromResource(resource);

        this.contextValues.push(AppResourceTreeItem.contextValue);

        // test for [label: string] keys
        this.groupConfig["location"] = { keyLabel: 'Locations', label: this.data.location || 'unknown', id: `${this.parent?.id}/${this.data.location}` }
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
                // TODO: concatenate context values
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

    public get contextValue(): string {
        return this.contextValues.sort().join(';');
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
        let iconName: string;
        const rType: string | undefined = this.data.type?.toLowerCase();
        if (rType && supportedIconTypes.includes(rType)) {
            iconName = rType;
            switch (rType) {
                case 'microsoft.web/sites':
                    if (this.data.kind?.toLowerCase().includes('functionapp')) {
                        iconName = iconName.replace('sites', 'functionapp');
                    }
                    break;
                default:
            }
            iconName = path.join('providers', iconName);
        } else {
            iconName = 'resource';
        }

        return treeUtils.getIconPath(iconName);
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
                return new ResourceTypeGroupTreeItem(this.rootGroupTreeItem, this.groupConfig.resourceType.label)
            // case 'resourceGroup':
            // TODO: Use ResovableTreeItem here
            // return new ResourceGroupTreeItem(this.rootGroupTreeItem, (await client.resourceGroups.get(this.groupConfig.resourceGroup.label)));
            default:
                return new LocationGroupTreeItem(this.rootGroupTreeItem, this.data.location?.toLocaleLowerCase() ?? 'No location');
        }
    }
}

// Execute `npm run listIcons` from root of repo to re-generate this list after adding an icon
export const supportedIconTypes: string[] = [
    'microsoft.web/functionapp',
    'microsoft.web/hostingenvironments',
    'microsoft.web/kubeenvironments',
    'microsoft.web/serverfarms',
    'microsoft.web/sites',
    'microsoft.web/staticsites',
    'microsoft.storage/storageaccounts',
    'microsoft.sql/servers',
    'microsoft.sql/servers/databases',
    'microsoft.signalrservice/signalr',
    'microsoft.servicefabricmesh/applications',
    'microsoft.servicefabric/clusters',
    'microsoft.servicebus/namespaces',
    'microsoft.operationsmanagement/solutions',
    'microsoft.operationalinsights/workspaces',
    'microsoft.notificationhubs/namespaces',
    'microsoft.network/applicationgateways',
    'microsoft.network/applicationsecuritygroups',
    'microsoft.network/loadbalancers',
    'microsoft.network/localnetworkgateways',
    'microsoft.network/networkinterfaces',
    'microsoft.network/networksecuritygroups',
    'microsoft.network/networkwatchers',
    'microsoft.network/publicipaddresses',
    'microsoft.network/publicipprefixes',
    'microsoft.network/routetables',
    'microsoft.network/virtualnetworkgateways',
    'microsoft.network/virtualnetworks',
    'microsoft.managedidentity/userassignedidentities',
    'microsoft.logic/workflows',
    'microsoft.kubernetes/connectedclusters',
    'microsoft.keyvault/vaults',
    'microsoft.insights/components',
    'microsoft.extendedlocation/customlocations',
    'microsoft.eventhub/namespaces',
    'microsoft.eventgrid/domains',
    'microsoft.eventgrid/eventsubscriptions',
    'microsoft.eventgrid/topics',
    'microsoft.documentdb/databaseaccounts',
    'microsoft.devtestlab/labs',
    'microsoft.devices/iothubs',
    'microsoft.dbforpostgresql/servers',
    'microsoft.dbformysql/servers',
    'microsoft.containerservice/managedclusters',
    'microsoft.containerregistry/registries',
    'microsoft.compute/availabilitysets',
    'microsoft.compute/disks',
    'microsoft.compute/images',
    'microsoft.compute/virtualmachines',
    'microsoft.compute/virtualmachinescalesets',
    'microsoft.cdn/profiles',
    'microsoft.cache/redis',
    'microsoft.batch/batchaccounts',
    'microsoft.apimanagement/service',
];
