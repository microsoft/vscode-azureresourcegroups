import * as vscode from 'vscode';
import { ApplicationResourceBranchDataProviderManager } from '../../tree/v2/providers/ApplicationResourceBranchDataProviderManager';
import { WorkspaceResourceBranchDataProviderManager } from '../../tree/v2/workspace/WorkspaceResourceBranchDataProviderManager';
import { ApplicationResourceProviderManager } from './ApplicationResourceProviderManager';
import { ApplicationResource, ApplicationResourceProvider, BranchDataProvider, ResourceModelBase, ResourcePickOptions, V2AzureResourcesApi, WorkspaceResource, WorkspaceResourceProvider } from './v2AzureResourcesApi';
import { WorkspaceResourceProviderManager } from './WorkspaceResourceProviderManager';

export class V2AzureResourcesApiImplementation implements V2AzureResourcesApi {
    public static apiVersion: string = '2.0.0';

    constructor(
        private readonly branchDataProviderManager: ApplicationResourceBranchDataProviderManager,
        private readonly resourceProviderManager: ApplicationResourceProviderManager,
        private readonly workspaceResourceBranchDataProviderManager: WorkspaceResourceBranchDataProviderManager,
        private readonly workspaceResourceProviderManager: WorkspaceResourceProviderManager) {
    }

    get apiVersion(): string {
        return V2AzureResourcesApiImplementation.apiVersion;
    }

    pickResource<TModel>(_options?: ResourcePickOptions | undefined): vscode.ProviderResult<TModel> {
        throw new Error("Method not implemented.");
    }

    revealResource(_resourceId: string): Promise<void> {
        throw new Error("Method not implemented.");
    }

    registerApplicationResourceProvider(_id: string, provider: ApplicationResourceProvider): vscode.Disposable {
        this.resourceProviderManager.addResourceProvider(provider);

        return new vscode.Disposable(() => this.resourceProviderManager.removeResourceProvider(provider));
    }

    registerApplicationResourceBranchDataProvider<T extends ResourceModelBase>(id: string, provider: BranchDataProvider<ApplicationResource, T>): vscode.Disposable {
        this.branchDataProviderManager.addProvider(id, provider);

        return new vscode.Disposable(() => this.branchDataProviderManager.removeProvider(id));
    }

    registerWorkspaceResourceProvider(_id: string, provider: WorkspaceResourceProvider): vscode.Disposable {
        this.workspaceResourceProviderManager.addResourceProvider(provider);

        return new vscode.Disposable(() => this.workspaceResourceProviderManager.removeResourceProvider(provider));
    }

    registerWorkspaceResourceBranchDataProvider<T extends ResourceModelBase>(type: string, provider: BranchDataProvider<WorkspaceResource, T>): vscode.Disposable {
        this.workspaceResourceBranchDataProviderManager.addProvider(type, provider);

        return new vscode.Disposable(() => this.workspaceResourceBranchDataProviderManager.removeProvider(type));
    }
}
