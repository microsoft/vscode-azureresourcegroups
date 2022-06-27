import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from "../../../api/v2/v2AzureResourcesApi";

export class BranchDataProviderManager extends vscode.Disposable {
    private readonly applicationResourceBranchDataProviders: { [key: string]: BranchDataProvider<ApplicationResource, ResourceModelBase> } = {};
    private readonly onDidChangeProvidersEmitter = new vscode.EventEmitter<void>();
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | ResourceModelBase | null | undefined>();

    private readonly changeSubscriptions: { [key: string]: vscode.Disposable } = {};

    constructor(private readonly defaultBranchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>) {
        super(
            () => {
                Object.values(this.changeSubscriptions).forEach(subscription => <never>subscription.dispose());
            });
    }

    get onDidChangeProviders(): vscode.Event<void> {
        return this.onDidChangeProvidersEmitter.event;
    }

    get onDidChangeTreeData(): vscode.Event<void | ResourceModelBase | null | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    addApplicationResourceBranchDataProvider(type: string, applicationResourceBranchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>): void {
        this.applicationResourceBranchDataProviders[type] = applicationResourceBranchDataProvider;

        if (applicationResourceBranchDataProvider.onDidChangeTreeData) {
            this.changeSubscriptions[type] = applicationResourceBranchDataProvider.onDidChangeTreeData(e => this.onDidChangeTreeDataEmitter.fire(e));
        }
    }

    getApplicationResourceBranchDataProvider(resource: ApplicationResource): BranchDataProvider<ApplicationResource, ResourceModelBase> {
        return this.applicationResourceBranchDataProviders[resource.type] ?? this.defaultBranchDataProvider;
    }

    removeApplicationResourceBranchDataProvider(type: string): void {
        delete this.applicationResourceBranchDataProviders[type];
    }
}

export type BranchDataProviderFactory = (ApplicationResource) => BranchDataProvider<ApplicationResource, ResourceModelBase>;

