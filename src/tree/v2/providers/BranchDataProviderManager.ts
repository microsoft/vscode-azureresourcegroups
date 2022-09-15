import { AzExtResourceType } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ResourceGroupsExtensionManager } from '../../../api/v2/ResourceGroupsExtensionManager';
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from "../../../api/v2/v2AzureResourcesApi";

export class BranchDataProviderManager extends vscode.Disposable {
    private readonly applicationResourceBranchDataProviders: { [key: string]: BranchDataProvider<ApplicationResource, ResourceModelBase> } = {};
    private readonly onDidChangeProvidersEmitter = new vscode.EventEmitter<void>();
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | ResourceModelBase | ResourceModelBase[] | null | undefined>();

    private readonly changeSubscriptions: { [key: string]: vscode.Disposable } = {};

    constructor(
        private readonly defaultBranchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>,
        private readonly extensionManager: ResourceGroupsExtensionManager) {
        super(
            () => {
                Object.values(this.changeSubscriptions).forEach(subscription => <never>subscription.dispose());
            });
    }

    get onDidChangeProviders(): vscode.Event<void> {
        return this.onDidChangeProvidersEmitter.event;
    }

    get onDidChangeTreeData(): vscode.Event<void | ResourceModelBase | ResourceModelBase[] | null | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    addApplicationResourceBranchDataProvider(type: AzExtResourceType, applicationResourceBranchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>): void {
        this.applicationResourceBranchDataProviders[type] = applicationResourceBranchDataProvider;

        if (applicationResourceBranchDataProvider.onDidChangeTreeData) {
            this.changeSubscriptions[type] = applicationResourceBranchDataProvider.onDidChangeTreeData(e => this.onDidChangeTreeDataEmitter.fire(e));
        }

        this.onDidChangeProvidersEmitter.fire();
    }

    getApplicationResourceBranchDataProvider(resource: ApplicationResource): BranchDataProvider<ApplicationResource, ResourceModelBase> {
        const provider = this.applicationResourceBranchDataProviders[resource.azExtResourceType ?? resource.type.type];

        if (provider) {
            return provider;
        }

        // NOTE: The default branch data provider will be returned until the extension is loaded.
        //       The extension will then register its branch data providers, resulting in a change event.
        //       The tree will then be refreshed, resulting in this method being called again.
        void this.extensionManager.activateApplicationResourceBranchDataProvider(resource.azExtResourceType ?? resource.type.type);

        return this.defaultBranchDataProvider;
    }

    removeApplicationResourceBranchDataProvider(type: AzExtResourceType): void {
        const subscription = this.changeSubscriptions[type];

        if (subscription) {
            delete this.changeSubscriptions[type];
        }

        delete this.applicationResourceBranchDataProviders[type];

        this.onDidChangeProvidersEmitter.fire();
    }
}

export type BranchDataProviderFactory = (ApplicationResource) => BranchDataProvider<ApplicationResource, ResourceModelBase>;

