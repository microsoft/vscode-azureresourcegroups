/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtResourceType } from '@microsoft/vscode-azext-utils';
import { Activity } from '@microsoft/vscode-azext-utils/hostapi';
import * as vscode from 'vscode';
import { registerActivity } from '../../activityLog/registerActivity';
import { AzureResourceBranchDataProviderManager } from '../../tree/v2/azure/AzureResourceBranchDataProviderManager';
import { WorkspaceResourceBranchDataProviderManager } from '../../tree/v2/workspace/WorkspaceResourceBranchDataProviderManager';
import { ApplicationResourceProviderManager, WorkspaceResourceProviderManager } from './ResourceProviderManagers';
import { AzureResource, AzureResourceProvider, BranchDataProvider, ResourceModelBase, V2AzureResourcesApi, WorkspaceResource, WorkspaceResourceProvider } from './v2AzureResourcesApi';

export class V2AzureResourcesApiImplementation implements V2AzureResourcesApi {
    public static apiVersion: string = '2.0.0';

    constructor(
        private readonly applicationResourceProviderManager: ApplicationResourceProviderManager,
        private readonly applicationResourceBranchDataProviderManager: AzureResourceBranchDataProviderManager,
        private readonly workspaceResourceProviderManager: WorkspaceResourceProviderManager,
        private readonly workspaceResourceBranchDataProviderManager: WorkspaceResourceBranchDataProviderManager) {
    }

    get apiVersion(): string {
        return V2AzureResourcesApiImplementation.apiVersion;
    }

    registerActivity(activity: Activity): Promise<void> {
        return registerActivity(activity);
    }

    registerApplicationResourceProvider(provider: AzureResourceProvider): vscode.Disposable {
        this.applicationResourceProviderManager.addResourceProvider(provider);

        return new vscode.Disposable(() => this.applicationResourceProviderManager.removeResourceProvider(provider));
    }

    registerApplicationResourceBranchDataProvider<T extends ResourceModelBase>(type: AzExtResourceType, provider: BranchDataProvider<AzureResource, T>): vscode.Disposable {
        this.applicationResourceBranchDataProviderManager.addProvider(type, provider);

        return new vscode.Disposable(() => this.applicationResourceBranchDataProviderManager.removeProvider(type));
    }

    registerWorkspaceResourceProvider(provider: WorkspaceResourceProvider): vscode.Disposable {
        this.workspaceResourceProviderManager.addResourceProvider(provider);

        return new vscode.Disposable(() => this.workspaceResourceProviderManager.removeResourceProvider(provider));
    }

    registerWorkspaceResourceBranchDataProvider<T extends ResourceModelBase>(type: string, provider: BranchDataProvider<WorkspaceResource, T>): vscode.Disposable {
        this.workspaceResourceBranchDataProviderManager.addProvider(type, provider);

        return new vscode.Disposable(() => this.workspaceResourceBranchDataProviderManager.removeProvider(type));
    }
}
