/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtResourceType } from '@microsoft/vscode-azext-utils';
import { AzureResource, AzureResourceProvider, BranchDataProvider, ResourceModelBase, WorkspaceResource, WorkspaceResourceProvider } from '@microsoft/vscode-azext-utils/hostapi.v2';
import * as vscode from 'vscode';
import { v2AzureResourcesApiInternal } from '../../../hostapi.v2.internal';
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
    workspaceResourceTreeDataProvider: WorkspaceResourceTreeDataProvider): v2AzureResourcesApiInternal {

    return {
        apiVersion: '2.0.0',

        registerActivity,

        azureResourceTreeDataProvider,
        workspaceResourceTreeDataProvider,

        registerAzureResourceProvider: (provider: AzureResourceProvider) => {
            azureResourceProviderManager.addResourceProvider(provider);
            return new vscode.Disposable(() => azureResourceProviderManager.removeResourceProvider(provider));
        },
        registerAzureResourceBranchDataProvider: <T extends ResourceModelBase>(type: AzExtResourceType, provider: BranchDataProvider<AzureResource, T>) => {
            azureResourceBranchDataProviderManager.addProvider(type, provider);
            return new vscode.Disposable(() => azureResourceBranchDataProviderManager.removeProvider(type));
        },

        registerWorkspaceResourceProvider: (provider: WorkspaceResourceProvider) => {
            workspaceResourceProviderManager.addResourceProvider(provider);
            return new vscode.Disposable(() => workspaceResourceProviderManager.removeResourceProvider(provider));
        },
        registerWorkspaceResourceBranchDataProvider: <T extends ResourceModelBase>(type: string, provider: BranchDataProvider<WorkspaceResource, T>) => {
            workspaceResourceBranchDataProviderManager.addProvider(type, provider);
            return new vscode.Disposable(() => workspaceResourceBranchDataProviderManager.removeProvider(type));
        },
    }
}
