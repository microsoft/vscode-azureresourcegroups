import { AzureExtensionApiProvider } from '@microsoft/vscode-azext-utils/api';
import * as vscode from 'vscode';
import { AzureAccountExtensionApi } from './azure-account.api';
import { ResourceGroupResourceBase } from './ResourceGroupResourceBase';
import { SubscriptionResource } from './SubscriptionResource';

export class ResourceGroupsTreeDataProvider implements vscode.TreeDataProvider<ResourceGroupResourceBase> {
    onDidChangeTreeData?: vscode.Event<void | ResourceGroupResourceBase | null | undefined> | undefined;

    getTreeItem(element: ResourceGroupResourceBase): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    async getChildren(element?: ResourceGroupResourceBase | undefined): Promise<ResourceGroupResourceBase[] | null | undefined> {
        if (element) {
            return await element.getChildren();
        } else {
            const extension = vscode.extensions.getExtension<AzureExtensionApiProvider>('ms-vscode.azure-account');

            if (extension) {
                if (!extension.isActive) {
                    await extension.activate();
                }

                const api = extension.exports.getApi<AzureAccountExtensionApi>('1');

                if (api) {
                    return api.filters.map(subscription => new SubscriptionResource(subscription));
                }
            }
        }

        return [];
    }
}
