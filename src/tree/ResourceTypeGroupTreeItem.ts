/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { localize } from "../utils/localize";
import { treeUtils } from "../utils/treeUtils";
import { ResourceTreeItem, supportedIconTypes } from "./ResourceTreeItem";
import path = require("path");

export class ResourceTypeGroupTreeItem extends AzExtParentTreeItem {
    public static contextValue: string = 'azureResourceTypeGroup';
    public readonly contextValue: string = ResourceTypeGroupTreeItem.contextValue;
    public readonly childTypeLabel: string = localize('resource', 'Resource');
    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    public items: ResourceTreeItem[];
    public type: string;

    private _nextLink: string | undefined;

    constructor(parent: AzExtParentTreeItem, type: string) {
        super(parent);
        this.type = type;
        this.items = [];
    }

    public get name(): string {
        return this.type;
    }

    public get id(): string {
        return this.type;
    }

    public get label(): string {
        return this.type;
    }

    public get iconPath(): TreeItemIconPath {
        let iconName: string;
        const rType: string | undefined = this.type.toLowerCase();
        if (rType && supportedIconTypes.includes(rType)) {
            iconName = rType;
            switch (rType) {
                case 'microsoft.web/sites':
                    if (this.label?.toLowerCase().includes('functionapp')) {
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

    public hasMoreChildrenImpl(): boolean {
        return !!this._nextLink;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        return this.items;
        // if (clearCache) {
        //     this._nextLink = undefined;
        // }

        // const client: ResourceManagementClient = await createResourceClient([context, this]);
        // // Load more currently broken https://github.com/Azure/azure-sdk-for-js/issues/20380
        // const resources: GenericResourceExpanded[] = await uiUtils.listAllIterator(client.resources.listByResourceGroup(this.name));
        // return await this.createTreeItemsWithErrorHandling(
        //     resources,
        //     'invalidResource',
        //     resource => {
        //         const hiddenTypes: string[] = [
        //             'microsoft.alertsmanagement/smartdetectoralertrules',
        //             'microsoft.insights/actiongroups',
        //             'microsoft.security/automations'
        //         ];

        //         if (settingUtils.getWorkspaceSetting<boolean>('showHiddenTypes') || (resource.type && !hiddenTypes.includes(resource.type.toLowerCase()))) {
        //             return new ResourceTreeItem(this, resource);
        //         } else {
        //             return undefined;
        //         }
        //     },
        //     resource => resource.name
        // );
    }
}
