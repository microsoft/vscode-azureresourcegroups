import { AzureExtensionApiProvider } from '@microsoft/vscode-azext-utils/api';
import * as vscode from 'vscode';
import { ApplicationResourceProviderManager } from '../../api/v2/providers/ApplicationResourceProviderManager';
import { localize } from '../../utils/localize';
import { ApplicationResourceGroupingManager } from './ApplicationResourceGroupingManager';
import { AzureAccountExtensionApi } from './azure-account.api';
import { GenericItem } from './GenericItem';
import { ResourceGroupResourceBase } from './ResourceGroupResourceBase';
import { SubscriptionItem } from './SubscriptionItem';

export class ResourceGroupsTreeDataProvider extends vscode.Disposable implements vscode.TreeDataProvider<ResourceGroupResourceBase> {
    private readonly resourceGroupingManager = new ApplicationResourceGroupingManager();
    private readonly groupingChangeSubscription: vscode.Disposable;
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | ResourceGroupResourceBase | null | undefined>();

    private api: AzureAccountExtensionApi | undefined;
    private filtersSubscription: vscode.Disposable | undefined;
    private statusSubscription: vscode.Disposable | undefined;

    constructor(private readonly resourceProviderManager: ApplicationResourceProviderManager) {
        super(
            () => {
                this.groupingChangeSubscription.dispose();
                this.filtersSubscription?.dispose();
                this.statusSubscription?.dispose();

                this.resourceGroupingManager.dispose();
            });

        // TODO: This really belongs on the subscription item, but that then involves disposing of them during refresh,
        //       and I'm not sure of the mechanics of that.  Ideally grouping mode changes shouldn't require new network calls,
        //       as we're just rearranging known items; we might try caching resource items and only calling getTreeItem() on
        //       branch providers during the tree refresh that results from this (rather than getChildren() again).
        this.groupingChangeSubscription = this.resourceGroupingManager.onDidChangeGrouping(() => this.onDidChangeTreeDataEmitter.fire());
    }

    onDidChangeTreeData: vscode.Event<void | ResourceGroupResourceBase | null | undefined> = this.onDidChangeTreeDataEmitter.event;

    getTreeItem(element: ResourceGroupResourceBase): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    async getChildren(element?: ResourceGroupResourceBase | undefined): Promise<ResourceGroupResourceBase[] | null | undefined> {
        if (element) {
            return await element.getChildren();
        } else {
            const api = await this.getApi();

            if (api) {
                if (api.status === 'LoggedIn') {
                    if (api.filters.length === 0) {
                        return [new GenericItem(localize('noSubscriptions', 'Select Subscriptions...'), { commandId: 'azure-account.selectSubscriptions' })]
                    } else {
                        return api.filters.map(subscription => new SubscriptionItem(subscription, this.resourceGroupingManager, this.resourceProviderManager));
                    }
                } else if (api.status === 'LoggedOut') {
                    return [
                        new GenericItem(
                            localize('signInLabel', 'Sign in to Azure...'),
                            {
                                commandId: 'azure-account.login',
                                iconPath: new vscode.ThemeIcon('sign-in')
                            }),
                        new GenericItem(
                            localize('createAccountLabel', 'Create an Azure Account...'),
                            {
                                commandId: 'azure-account.createAccount',
                                iconPath: new vscode.ThemeIcon('add')
                            }),
                        new GenericItem(
                            localize('createStudentAccount', 'Create an Azure for Students Account...'),
                            {
                                commandId: 'azureResourceGroups.openUrl',
                                commandArgs: ['https://aka.ms/student-account'],
                                iconPath: new vscode.ThemeIcon('mortar-board')
                            }),
                    ];
                } else {
                    return [
                        new GenericItem(
                            api.status === 'Initializing'
                                ? localize('loadingTreeItem', 'Loading...')
                                : localize('signingIn', 'Waiting for Azure sign-in...'),
                            {
                                commandId: 'azure-account.login',
                                iconPath: new vscode.ThemeIcon('loading~spin')
                            })
                    ];
                }
            }
        }

        return undefined;
    }

    private async getApi(): Promise<AzureAccountExtensionApi | undefined> {
        if (!this.api) {
            const extension = vscode.extensions.getExtension<AzureExtensionApiProvider>('ms-vscode.azure-account');

            if (extension) {
                if (!extension.isActive) {
                    await extension.activate();
                }

                this.api = extension.exports.getApi<AzureAccountExtensionApi>('1');

                if (this.api) {
                    await this.api.waitForFilters();

                    this.filtersSubscription = this.api.onFiltersChanged(() => this.onDidChangeTreeDataEmitter?.fire());
                    this.statusSubscription = this.api.onStatusChanged(() => this.onDidChangeTreeDataEmitter?.fire());
                }
            }
        }

        return this.api;
    }
}
