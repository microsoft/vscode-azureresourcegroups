import * as vscode from 'vscode';
import { ApplicationResource, ApplicationResourceProvider, ResourceManager, ResourcePickOptions, V2AzureResourcesApi, WorkspaceResource, WorkspaceResourceProvider } from './v2AzureResourcesApi';

export class V2AzureResourcesApiImplementation implements V2AzureResourcesApi {
    get apiVersion(): string {
        return '2.0.0';
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    pickResource<TModel>(_options?: ResourcePickOptions | undefined): vscode.ProviderResult<TModel> {
        throw new Error("Method not implemented.");
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    revealResource(_resourceId: string): Promise<void> {
        throw new Error("Method not implemented.");
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    registerApplicationResourceProvider(_id: string, _provider: ApplicationResourceProvider): vscode.Disposable {
        throw new Error("Method not implemented.");
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    registerApplicationResourceManager<T>(_id: string, _provider: ResourceManager<ApplicationResource, T>): vscode.Disposable {
        throw new Error("Method not implemented.");
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    registerWorkspaceResourceProvider(_id: string, _provider: WorkspaceResourceProvider): vscode.Disposable {
        throw new Error("Method not implemented.");
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    registerWorkspaceResourceManager<T>(_id: string, _provider: ResourceManager<WorkspaceResource, T>): vscode.Disposable {
        throw new Error("Method not implemented.");
    }
}
