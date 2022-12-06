/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtResourceType } from '@microsoft/vscode-azext-utils';
import { AzureResource, AzureResourceProvider, BranchDataProvider, ResourceModelBase, v2AzureResourcesApi, WorkspaceResource, WorkspaceResourceProvider } from '@microsoft/vscode-azext-utils/hostapi.v2';
import * as vscode from 'vscode';
import { registerActivity } from '../../activityLog/registerActivity';
import { AzureResourceBranchDataProviderManager } from '../../tree/v2/azure/AzureResourceBranchDataProviderManager';
import { AzureResourceTreeDataProvider } from '../../tree/v2/azure/AzureResourceTreeDataProvider';
import { WorkspaceResourceBranchDataProviderManager } from '../../tree/v2/workspace/WorkspaceResourceBranchDataProviderManager';
import { WorkspaceResourceTreeDataProvider } from '../../tree/v2/workspace/WorkspaceResourceTreeDataProvider';
import { AzureResourceProviderManager, WorkspaceResourceProviderManager } from './ResourceProviderManagers';

export function createV2AzureResourcesApi(
    azureResourceProviderManager: AzureResourceProviderManager,
    azureResourceBranchDataProviderManager: AzureResourceBranchDataProviderManager,
    azureResourceTreeDataProvider: AzureResourceTreeDataProvider,
    workspaceResourceProviderManager: WorkspaceResourceProviderManager,
    workspaceResourceBranchDataProviderManager: WorkspaceResourceBranchDataProviderManager,
    workspaceResourceTreeDataProvider: WorkspaceResourceTreeDataProvider): v2AzureResourcesApi {

    return {
        apiVersion: '2.0.0',

        azureResourceTreeDataProvider,
        workspaceResourceTreeDataProvider,

        registerActivity,

        registerAzureResourceProvider: (provider: AzureResourceProvider): vscode.Disposable => {
            azureResourceProviderManager.addResourceProvider(provider);
            return new vscode.Disposable(() => azureResourceProviderManager.removeResourceProvider(provider));
        },
        registerAzureResourceBranchDataProvider: <T extends ResourceModelBase>(type: AzExtResourceType, provider: BranchDataProvider<AzureResource, T>): vscode.Disposable => {
            azureResourceBranchDataProviderManager.addProvider(type, provider);
            return new vscode.Disposable(() => azureResourceBranchDataProviderManager.removeProvider(type));
        },

        registerWorkspaceResourceProvider: (provider: WorkspaceResourceProvider): vscode.Disposable => {
            workspaceResourceProviderManager.addResourceProvider(provider);
            return new vscode.Disposable(() => workspaceResourceProviderManager.removeResourceProvider(provider));
        },
        registerWorkspaceResourceBranchDataProvider: <T extends ResourceModelBase>(type: string, provider: BranchDataProvider<WorkspaceResource, T>) => {
            workspaceResourceBranchDataProviderManager.addProvider(type, provider);
            return new vscode.Disposable(() => workspaceResourceBranchDataProviderManager.removeProvider(type));
        },
    }
}
