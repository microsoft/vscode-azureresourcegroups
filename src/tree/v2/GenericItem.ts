import { TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ResourceGroupResourceBase } from "./ResourceGroupResourceBase";

export interface GenericItemOptions {
    readonly children?: ResourceGroupResourceBase[];
    readonly commandArgs?: unknown[];
    readonly commandId?: string;
    readonly iconPath?: TreeItemIconPath;
}

export class GenericItem implements ResourceGroupResourceBase {
    constructor(public readonly label: string, private readonly options?: GenericItemOptions) {
    }

    getChildren(): vscode.ProviderResult<ResourceGroupResourceBase[]> {
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
}
