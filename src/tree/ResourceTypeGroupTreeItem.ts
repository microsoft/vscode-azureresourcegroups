/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { treeUtils } from "../utils/treeUtils";
import { GroupTreeItemBase } from "./GroupTreeItemBase";
import { supportedIconTypes } from "./ResourceTreeItem";
import path = require("path");

export class ResourceTypeGroupTreeItem extends GroupTreeItemBase {
    public static contextValue: string = 'azureResourceTypeGroup';
    public readonly contextValue: string = ResourceTypeGroupTreeItem.contextValue;
    public type: string;

    constructor(parent: AzExtParentTreeItem, type: string) {
        super(parent);
        this.type = type;
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
