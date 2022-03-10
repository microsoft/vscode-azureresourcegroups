/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, IActionContext } from "@microsoft/vscode-azext-utils";
import { localize } from "../utils/localize";
import { ResolvableTreeItemBase } from "./ResolvableTreeItemBase";

export abstract class GroupTreeItemBase extends AzExtParentTreeItem {
    public readonly childTypeLabel: string = localize('resource', 'Resource');
    public treeMap: { [key: string]: ResolvableTreeItemBase } = {};
    public abstract label;

    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    private _nextLink: string | undefined;

    public hasMoreChildrenImpl(): boolean {
        return !!this._nextLink;
    }

    public async loadMoreChildrenImpl(clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        if (clearCache) {
            // this.treeMap = {};
        }

        for (const ti of Object.values(this.treeMap)) {
            if (ti instanceof ResolvableTreeItemBase) {
                void ti.resolve(clearCache, context);
            }
        }

        return Object.values(this.treeMap) as AzExtTreeItem[];
    }
}
