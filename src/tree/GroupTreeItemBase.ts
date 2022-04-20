/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { TreeItemCollapsibleState } from "vscode";
import { AppResourceResolver, GroupNodeConfiguration } from "../api";
import { ext } from "../extensionVariables";
import { localize } from "../utils/localize";
import { treeUtils } from "../utils/treeUtils";
import { ResolvableTreeItemBase } from "./ResolvableTreeItemBase";

export class GroupTreeItemBase extends AzExtParentTreeItem {
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
        const contextValues = new Set([...this.config.contextValuesToAdd ?? [], ...this.internalContextValuesToAdd, 'group']);
        if (focusedGroup?.toLowerCase() === this.id.toLowerCase()) {
            contextValues.add('focused');
        } else {
            contextValues.add('unfocused')
        }
        return Array.from(contextValues).sort().join(';');
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

    public async resolveVisibleChildren(context: IActionContext, resolver: AppResourceResolver): Promise<void> {
        // TODO: `collapsibleState` needs to be made visible on `AzExtTreeItem`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        if ((this as any).collapsibleState !== TreeItemCollapsibleState.Expanded) {
            // Nothing to do if this node isn't expanded
            return;
        }

        const childrenOfType = Object.values(this.treeMap).filter(c => resolver.matchesResource(c.data));
        const childPromises = childrenOfType.map(resolvable => resolvable.resolve(true, context));

        await Promise.all(childPromises);
    }

    public get iconPath(): TreeItemIconPath | undefined {
        return this.config.icon ?? this.config.iconPath ?? treeUtils.getIconPath('resource');
    }

    public hasChildren(): boolean {
        return !!Object.values(this.treeMap).length;
    }
}
