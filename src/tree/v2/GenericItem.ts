import * as vscode from 'vscode';
import { ResourceGroupResourceBase } from "./ResourceGroupResourceBase";

export class GenericItem implements ResourceGroupResourceBase {
    constructor(private readonly label: string, private readonly commandId?: string) {
    }

    getChildren(): vscode.ProviderResult<ResourceGroupResourceBase[]> {
        return undefined;
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.label);

        if (this.commandId) {
            treeItem.command = {
                command: this.commandId,
                title: ''
            };
        }

        return treeItem;
    }
}
