/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { GroupNodeConfiguration } from "@microsoft/vscode-azext-utils/hostapi";
import { ext } from "../extensionVariables";
import { localize } from "../utils/localize";
import { treeUtils } from "../utils/treeUtils";
import { ResolvableTreeItemBase } from "./ResolvableTreeItemBase";

export class GroupTreeItemBase extends AzExtParentTreeItem {
    public static contextValue = 'group';
    public readonly childTypeLabel: string = localize('resource', 'Resource');
    public treeMap: { [key: string]: ResolvableTreeItemBase } = {};
    public config: GroupNodeConfiguration;

    protected internalContextValuesToAdd: string[] = []

    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    constructor(parent: AzExtParentTreeItem, config: GroupNodeConfiguration) {
        super(parent);
        this.config = config;
    }

    public get id(): string {
        return this.config.id;
    }

    public get label(): string {
        return this.config.label;
    }

    public get contextValue(): string {
        const focusedGroup = ext.context.workspaceState.get<string>('focusedGroup');
        const contextValues = [...this.config.contextValuesToAdd ?? [], ...this.internalContextValuesToAdd, GroupTreeItemBase.contextValue];
        if (focusedGroup?.toLowerCase() === this.id.toLowerCase()) {
            contextValues.push('focused');
        } else {
            contextValues.push('unfocused')
        }
        return Array.from(new Set(contextValues)).sort().join(';');
    }

    public get description(): string | undefined {
        return this.config.description;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
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

    public get iconPath(): TreeItemIconPath | undefined {
        return this.config.icon ?? this.config.iconPath ?? treeUtils.getIconPath('resource');
    }

    public hasChildren(): boolean {
        return !!Object.values(this.treeMap).length;
    }
}
