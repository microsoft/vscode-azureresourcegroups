import { AzExtServiceClientCredentials, nonNullProp } from '@microsoft/vscode-azext-utils';
import { AzureExtensionApiProvider } from '@microsoft/vscode-azext-utils/api';
import * as vscode from 'vscode';
import { ApplicationResourceProviderManager } from '../../api/v2/providers/ApplicationResourceProviderManager';
import { ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
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
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>();

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
            (e: void | ResourceModelBase | ResourceModelBase[] | null | undefined) => {
                const rgItems: ResourceGroupsItem[] = [];

                // eslint-disable-next-line no-extra-boolean-cast
                if (!!e) {
                    // e was defined, either a single item or array
                    // Make an array for consistency
                    const branchItems: unknown[] = Array.isArray(e) ? e : [e];

                    for (const branchItem of branchItems) {
                        const rgItem = this.itemCache.getItemForBranchItem(branchItem);

                        if (rgItem) {
                            rgItems.push(rgItem);
                        }
                    }
                } else {
                    // e was null/undefined/void
                    // Translate it to fire on all elements for this branch data provider
                    // TODO
                }

                this.onDidChangeTreeDataEmitter.fire(rgItems)
            });

        // TODO: This really belongs on the subscription item, but that then involves disposing of them during refresh,
        //       and I'm not sure of the mechanics of that.  Ideally grouping mode changes shouldn't require new network calls,
        //       as we're just rearranging known items; we might try caching resource items and only calling getTreeItem() on
        //       branch providers during the tree refresh that results from this (rather than getChildren() again).
        this.groupingChangeSubscription = this.resourceGroupingManager.onDidChangeGrouping(() => this.onDidChangeTreeDataEmitter.fire());

        this.refreshSubscription = refreshEvent(() => this.onDidChangeTreeDataEmitter.fire());
    }

    onDidChangeTreeData: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined> = this.onDidChangeTreeDataEmitter.event;

    getTreeItem(element: ResourceGroupsItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    getParent(element: ResourceGroupsItem): vscode.ProviderResult<ResourceGroupsItem> {
        return this.itemCache.getParentForItem(element);
    }

    async getChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        return this.cacheChildren(
            element,
            async () => {
                if (element) {
                    return await element.getChildren();
                } else {
                    // We're effectively redrawing the entire tree, so we need to clear the cache...
                    // TODO: Isn't this already done within cacheChildren()?
                    // this.itemCache.evictAll();

                    const api = await this.getApi();

                    if (api) {
                        if (api.status === 'LoggedIn') {
                            if (api.filters.length === 0) {
                                return [new GenericItem(localize('noSubscriptions', 'Select Subscriptions...'), { commandId: 'azure-account.selectSubscriptions' })]
                            } else {
                                // TODO: This needs to be environment-specific (in terms of default scopes).
                                const session = await vscode.authentication.getSession('microsoft', ['https://management.azure.com/.default', 'offline_access'], { createIfNone: true });

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
                                            getParent: item => this.itemCache.getParentForItem(item),
                                            refresh: item => this.onDidChangeTreeDataEmitter.fire(item),
                                        },
                                        this.resourceGroupingManager,
                                        this.resourceProviderManager,
                                        {
                                            authentication: {
                                                getSession: () => session
                                            },
                                            displayName: subscription.subscription.displayName || 'TODO: ever undefined?',
                                            environment: subscription.session.environment,
                                            isCustomCloud: subscription.session.environment.name === 'AzureCustomCloud',
                                            subscriptionId: subscription.subscription.subscriptionId || 'TODO: ever undefined?',
                                        }));
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
