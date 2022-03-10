/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { ThemeIcon } from "vscode";
import { localize } from "../utils/localize";
import { AppResourceTreeItem } from "./AppResourceTreeItem";
import { GroupTreeItemBase } from "./GroupTreeItemBase";

export class LocationGroupTreeItem extends GroupTreeItemBase {
    public static contextValue: string = 'locationGroup';
    public readonly contextValue: string = LocationGroupTreeItem.contextValue;
    public readonly childTypeLabel: string = localize('resource', 'Resource');
    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    public items: AppResourceTreeItem[];
    public location: string;

    constructor(parent: AzExtParentTreeItem, location: string) {
        super(parent);
        this.location = location;
        this.items = [];
    }

    public get name(): string {
        return this.location;
    }

    public get id(): string {
        return this.location;
    }

    public get label(): string {
        return this.location;
    }

    public get iconPath(): TreeItemIconPath {
        return new ThemeIcon('globe');
    }
}
