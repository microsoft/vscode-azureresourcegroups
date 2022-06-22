import * as vscode from 'vscode';
import { ResourceGroupResourceBase } from "./ResourceGroupResourceBase";

export interface GenericItemOptions {
    readonly commandArgs?: unknown[];
    readonly commandId?: string;
    readonly iconPath?: vscode.ThemeIcon;
}

export class GenericItem implements ResourceGroupResourceBase {
    constructor(private readonly label: string, private readonly options?: GenericItemOptions) {
    }

    getChildren(): vscode.ProviderResult<ResourceGroupResourceBase[]> {
        return undefined;
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.label);

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
