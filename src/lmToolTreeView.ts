
// Map resourceType to icon file path
function getResourceTypeIconPath(resourceType: string): vscode.Uri | undefined {
    // Add mappings for known resource types
    const iconMap: Record<string, string> = {
        'Microsoft.Web/sites': 'AppServices.svg',
        'Microsoft.Resources/resourceGroups': 'resourceGroup.svg',
        'Microsoft.KeyVault/vaults': 'KeyVaults.svg',
        'Microsoft.Storage/storageAccounts': 'ContainerRegistry.svg',
        'Microsoft.DocumentDB/databaseAccounts': 'AzureCosmosDb.svg',
        'Microsoft.ContainerInstance/containerGroups': 'ContainerApps.svg',
        'Microsoft.ManagedIdentity/userAssignedIdentities': 'ManagedIdentityUserAssignedIdentities.svg',
        // Add more mappings as needed
    };
    const iconFile = iconMap[resourceType];
    if (iconFile) {
        // Use workspace-relative path to resources/azureIcons
        const basePath = vscode.Uri.file(__dirname + '/../../resources/azureIcons');
        return vscode.Uri.joinPath(basePath, iconFile);
    }
    // Fallback: use no icon
    return undefined;
}
import * as vscode from 'vscode';

export interface LmTreeNode {
    label: string;
    resourceType?: string;
    children?: (LmTreeNode & Record<string, unknown>)[];
}

export class LmToolTreeDataProvider implements vscode.TreeDataProvider<LmTreeNode> {
    getChildren(element?: LmTreeNode): LmTreeNode[] {
        if (!this.tree) {
            return [];
        }
        if (!element) {
            return [this.tree];
        }
        return element.children || [];
    }
    private _onDidChangeTreeData: vscode.EventEmitter<LmTreeNode | undefined | void> = new vscode.EventEmitter<LmTreeNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<LmTreeNode | undefined | void> = this._onDidChangeTreeData.event;

    private tree: LmTreeNode | null = null;

    setTree(tree: LmTreeNode) {
        this.tree = tree;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: LmTreeNode): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, element.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        // Icon support for resourceType
        if (element.resourceType && typeof element.resourceType === 'string') {
            const iconPath = getResourceTypeIconPath(element.resourceType);
            if (iconPath) {
                item.iconPath = iconPath;
            }
        }
        return item;
    }
}
