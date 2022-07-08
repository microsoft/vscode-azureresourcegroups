import { AzExtServiceClientCredentials, nonNullProp } from '@microsoft/vscode-azext-utils';
import { AzureExtensionApiProvider } from '@microsoft/vscode-azext-utils/api';
import * as vscode from 'vscode';
import { ApplicationResourceProviderManager } from '../../api/v2/providers/ApplicationResourceProviderManager';
import { localize } from '../../utils/localize';
import { ApplicationResourceGroupingManager } from './ApplicationResourceGroupingManager';
import { AzureAccountExtensionApi } from './azure-account.api';
import { GenericItem } from './GenericItem';
import { BranchDataProviderManager } from './providers/BranchDataProviderManager';
import { ResourceGroupsItem } from './ResourceGroupsItem';
import { ResourceGroupsItemCache } from './ResourceGroupsItemCache';
import { SubscriptionItem } from './SubscriptionItem';

export class ResourceGroupsTreeDataProvider extends vscode.Disposable implements vscode.TreeDataProvider<ResourceGroupsItem> {
    private readonly branchChangeSubscription: vscode.Disposable;
    private readonly groupingChangeSubscription: vscode.Disposable;
    private readonly providersChangeSubscription: vscode.Disposable;
    private readonly refreshSubscription: vscode.Disposable;
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | ResourceGroupsItem | null | undefined>();

    private api: AzureAccountExtensionApi | undefined;
    private filtersSubscription: vscode.Disposable | undefined;
    private statusSubscription: vscode.Disposable | undefined;

    constructor(
        branchDataProviderManager: BranchDataProviderManager,
        private readonly itemCache: ResourceGroupsItemCache,
        refreshEvent: vscode.Event<void>,
        private readonly resourceGroupingManager: ApplicationResourceGroupingManager,
        private readonly resourceProviderManager: ApplicationResourceProviderManager) {
        super(
            () => {
                this.branchChangeSubscription.dispose();
                this.groupingChangeSubscription.dispose();
                this.filtersSubscription?.dispose();
                this.providersChangeSubscription.dispose();
                this.refreshSubscription.dispose();
                this.statusSubscription?.dispose();
            });

        this.providersChangeSubscription = branchDataProviderManager.onDidChangeProviders(() => this.onDidChangeTreeDataEmitter.fire());

        this.branchChangeSubscription = branchDataProviderManager.onDidChangeTreeData(
            e => {
                const item = this.itemCache.getItemForBranchItem(e);

                if (item) {
                    this.onDidChangeTreeDataEmitter.fire(item)
                }
            });

        // TODO: This really belongs on the subscription item, but that then involves disposing of them during refresh,
        //       and I'm not sure of the mechanics of that.  Ideally grouping mode changes shouldn't require new network calls,
        //       as we're just rearranging known items; we might try caching resource items and only calling getTreeItem() on
        //       branch providers during the tree refresh that results from this (rather than getChildren() again).
        this.groupingChangeSubscription = this.resourceGroupingManager.onDidChangeGrouping(() => this.onDidChangeTreeDataEmitter.fire());

        this.refreshSubscription = refreshEvent(() => this.onDidChangeTreeDataEmitter.fire());
    }

    onDidChangeTreeData: vscode.Event<void | ResourceGroupsItem | null | undefined> = this.onDidChangeTreeDataEmitter.event;

    getTreeItem(element: ResourceGroupsItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    async getChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        return this.cacheChildren(
            element,
            async () => {
                if (element) {
                    return await element.getChildren();
                } else {
                    // We're effectively redrawing the entire tree, so we need to clear the cache...
                    this.itemCache.evictAll();

                    const api = await this.getApi();

                    if (api) {
                        if (api.status === 'LoggedIn') {
                            if (api.filters.length === 0) {
                                return [new GenericItem(localize('noSubscriptions', 'Select Subscriptions...'), { commandId: 'azure-account.selectSubscriptions' })]
                            } else {
                                return api.filters.map(
                                    subscription => new SubscriptionItem(
                                        {
                                            subscriptionContext: {
                                                credentials: <AzExtServiceClientCredentials>subscription.session.credentials2,
                                                subscriptionDisplayName: nonNullProp(subscription.subscription, 'displayName'),
                                                subscriptionId: nonNullProp(subscription.subscription, 'subscriptionId'),
                                                subscriptionPath: nonNullProp(subscription.subscription, 'id'),
                                                tenantId: subscription.session.tenantId,
                                                userId: subscription.session.userId,
                                                environment: subscription.session.environment,
                                                isCustomCloud: subscription.session.environment.name === 'AzureCustomCloud'
                                            },
                                            subscription: {
                                                credentials: subscription.session.credentials2,
                                                displayName: subscription.subscription.displayName || 'TODO: ever undefined?',
                                                environment: subscription.session.environment,
                                                isCustomCloud: subscription.session.environment.name === 'AzureCustomCloud',
                                                subscriptionId: subscription.subscription.subscriptionId || 'TODO: ever undefined?',
                                            },
                                            getParent: item => this.itemCache.getParentForItem(item),
                                            refresh: item => this.onDidChangeTreeDataEmitter.fire(item),
                                        },
                                        this.resourceGroupingManager,
                                        this.resourceProviderManager));
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
            });
    }

    refreshItem(item?: ResourceGroupsItem): void {
        this.onDidChangeTreeDataEmitter.fire(item);
    }

    private async cacheChildren(element: ResourceGroupsItem | undefined, callback: () => Promise<ResourceGroupsItem[] | null | undefined>): Promise<ResourceGroupsItem[] | null | undefined> {
        if (element) {
            // TODO: Do we really need to evict before generating new children, or can we just update after the fact?
            //       Since the callback is async, could change notifications show up while doing this?
            this.itemCache.evictItemChildren(element);
        } else {
            this.itemCache.evictAll();
        }

        const children = await callback();

        if (children) {
            if (element) {
                this.itemCache.updateItemChildren(element, children);
            } else {
                children.forEach(child => this.itemCache.addItem(child, []));
            }
        }

        return children;
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
