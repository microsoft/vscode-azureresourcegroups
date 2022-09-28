/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ApplicationResourceBranchDataProviderManager } from '../../tree/v2/application/ApplicationResourceBranchDataProviderManager';
import { WorkspaceResourceBranchDataProviderManager } from '../../tree/v2/workspace/WorkspaceResourceBranchDataProviderManager';
import { ApplicationResourceProviderManager } from './ApplicationResourceProviderManager';
import { ApplicationResource, ApplicationResourceProvider, BranchDataProvider, ResourceModelBase, ResourcePickOptions, V2AzureResourcesApi, WorkspaceResource, WorkspaceResourceProvider } from './v2AzureResourcesApi';
import { WorkspaceResourceProviderManager } from './WorkspaceResourceProviderManager';

export class V2AzureResourcesApiImplementation implements V2AzureResourcesApi {
    public static apiVersion: string = '2.0.0';

    constructor(
        private readonly applicationResourceProviderManager: ApplicationResourceProviderManager,
        private readonly applicationResourceBranchDataProviderManager: ApplicationResourceBranchDataProviderManager,
        private readonly workspaceResourceProviderManager: WorkspaceResourceProviderManager,
        private readonly workspaceResourceBranchDataProviderManager: WorkspaceResourceBranchDataProviderManager) {
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
        this.applicationResourceProviderManager.addResourceProvider(provider);

        return new vscode.Disposable(() => this.applicationResourceProviderManager.removeResourceProvider(provider));
    }

    registerApplicationResourceBranchDataProvider<T extends ResourceModelBase>(id: string, provider: BranchDataProvider<ApplicationResource, T>): vscode.Disposable {
        this.applicationResourceBranchDataProviderManager.addProvider(id, provider);

        return new vscode.Disposable(() => this.applicationResourceBranchDataProviderManager.removeProvider(id));
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
