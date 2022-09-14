import { TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ResourceGroupsItem } from "./ResourceGroupsItem";

export interface GenericItemOptions {
    readonly children?: ResourceGroupsItem[];
    readonly commandArgs?: unknown[];
    readonly commandId?: string;
    readonly iconPath?: TreeItemIconPath;
}

export class GenericItem implements ResourceGroupsItem {
    constructor(public readonly label: string, private readonly options?: GenericItemOptions) {
    }

    getChildren(): vscode.ProviderResult<ResourceGroupsItem[]> {
        return this.options?.children;
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.label, this.options?.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

        if (this.options?.commandId) {
            treeItem.command = {
                arguments: this.options.commandArgs,
                command: this.options.commandId,
                title: ''
            };
        }

        treeItem.iconPath = this.options?.iconPath;

        return treeItem;
    }

    public get quickPickOptions(): { readonly contextValues: string[]; readonly isLeaf: boolean; } {
        return {
            contextValues: [],
            isLeaf: !!this.options?.children && this.options.children.length > 0,
        }
    }

    public id: string;
}
