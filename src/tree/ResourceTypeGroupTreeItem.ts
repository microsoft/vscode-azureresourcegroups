/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { localize } from "../utils/localize";
import { treeUtils } from "../utils/treeUtils";
import { supportedIconTypes } from "./AppResourceTreeItem";
import { AppResourceTreeItemBase } from "./AppResourceTreeItemBase";
import { GroupTreeItemBase } from "./GroupTreeItemBase";
import { ShallowResourceTreeItem } from "./ShallowResourceTreeItem";
import path = require("path");

export class ResourceTypeGroupTreeItem extends GroupTreeItemBase {
    public readonly contextValue: string = `azureResourceTypeGroup`;
    public readonly childTypeLabel: string = localize('resource', 'Resource');
    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    public items: (AppResourceTreeItemBase | ShallowResourceTreeItem)[];
    public type: string;

    constructor(parent: AzExtParentTreeItem, type: string) {
        super(parent);
        this.type = type;
        this.contextValue = `azureResourceTypeGroup/${this.type}`;
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
}
