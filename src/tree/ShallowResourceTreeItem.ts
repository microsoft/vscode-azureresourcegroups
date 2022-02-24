/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResource } from "@azure/arm-resources";
import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, nonNullProp, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import * as path from 'path';
import { FileChangeType } from "vscode";
import { GroupableResource, GroupingConfig } from "../api";
import { ext } from "../extensionVariables";
import { createGroupConfigFromResource } from "../utils/azureUtils";
import { treeUtils } from "../utils/treeUtils";
import { GroupTreeItemBase } from "./GroupTreeItemBase";
import { LocationGroupTreeItem } from "./LocationGroupTreeItem";
import { ResourceTypeGroupTreeItem } from "./ResourceTypeGroupTreeItem";
import { SubscriptionTreeItem } from "./SubscriptionTreeItem";

/**
 * Represents a resource that does not have an associated extension.
 */
export class ShallowResourceTreeItem extends AzExtTreeItem implements GroupableResource {
    public static contextValue: string = 'azureResource';
    public readonly contextValue: string = ShallowResourceTreeItem.contextValue;
    public data: GenericResource;
    public rootGroupTreeItem: AzExtParentTreeItem;

    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    constructor(parent: AzExtParentTreeItem, resource: GenericResource) {
        super(parent);
        this.data = resource;
        this.rootGroupTreeItem = parent;

        this.commandId = 'azureResourceGroups.revealResource';
        this.groupConfig = createGroupConfigFromResource(resource);
        ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this });
    }
    groupConfig: GroupingConfig;

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

    public async mapSubGroupConfigTree(context: IActionContext, groupBySetting: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        let subGroupTreeItem = (<SubscriptionTreeItem>this.rootGroupTreeItem).getSubConfigGroupTreeItem(this.groupConfig[groupBySetting].id)
        if (!subGroupTreeItem) {
            subGroupTreeItem = this.createSubGroupTreeItem(groupBySetting);
            (<SubscriptionTreeItem>this.rootGroupTreeItem).setSubConfigGroupTreeItem(this.groupConfig[groupBySetting].id, subGroupTreeItem)
        }

        subGroupTreeItem.treeMap[this.id] = this;
        // this should actually be "resolve"
        void subGroupTreeItem.refresh(context);
    }

    public createSubGroupTreeItem(groupBySetting: string): GroupTreeItemBase {
        switch (groupBySetting) {
            case 'resourceType':
                return new ResourceTypeGroupTreeItem(this.rootGroupTreeItem, this.groupConfig.resourceType.label)
            case 'resourceGroup':
            // TODO: Use ResovableTreeItem here
            // TODO: Make it sync to create this and then resolve to a RG TreeItem
            // return new ResourceGroupTreeItem(this.rootGroupTreeItem);
            default:
                return new LocationGroupTreeItem(this.rootGroupTreeItem, this.data.location!.toLocaleLowerCase());
        }
    }
}

// Execute `npm run listIcons` from root of repo to re-generate this list after adding an icon
const supportedIconTypes: string[] = [
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
