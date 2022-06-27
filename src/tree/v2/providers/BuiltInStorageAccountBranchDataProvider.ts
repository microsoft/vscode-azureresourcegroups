import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider } from '../../../api/v2/v2AzureResourcesApi';
import { ResourceGroupItem } from '../ResourceGroupItem';
import { BuiltInResourceModelBase } from './BuiltInResourceModelBase';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface BuiltInStorageAccountItem extends BuiltInResourceModelBase {
}

class StorageAccountItem implements BuiltInStorageAccountItem {
    constructor(private readonly applicationResource: ApplicationResource) {
    }

    getChildren(): vscode.ProviderResult<ResourceGroupItem[]> {
        return [];
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.applicationResource.name ?? 'Unnamed Resource');

        return treeItem;
    }
}

export class BuiltInStorageAccountBranchDataProvider extends vscode.Disposable implements BranchDataProvider<ApplicationResource, BuiltInStorageAccountItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<BuiltInStorageAccountItem>();

    constructor() {
        super(
            () => {
                this.onDidChangeTreeDataEmitter.dispose();
            });
    }

    get onDidChangeTreeData(): vscode.Event<BuiltInStorageAccountItem> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    getChildren(element: BuiltInStorageAccountItem): vscode.ProviderResult<BuiltInStorageAccountItem[]> {
        return element.getChildren();
    }

    getResourceItem(element: ApplicationResource): BuiltInStorageAccountItem | Thenable<BuiltInStorageAccountItem> {
        return new StorageAccountItem(element);
    }

    getTreeItem(element: BuiltInStorageAccountItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }
}
