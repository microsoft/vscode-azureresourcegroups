/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtResourceType } from '@microsoft/vscode-azext-utils';
import { AzureResource, BranchDataProvider, ResourceModelBase, WorkspaceResource, WorkspaceResourceProvider } from '@microsoft/vscode-azext-utils/hostapi.v2';
import * as vscode from 'vscode';
import { AzureResourceProvider, AzureResourcesHostApiInternal } from '../../../hostapi.v2.internal';
import { AzureResourceBranchDataProviderManager } from '../../tree/v2/azure/AzureResourceBranchDataProviderManager';
import { AzureResourceTreeDataProvider } from '../../tree/v2/azure/AzureResourceTreeDataProvider';
import { WorkspaceResourceBranchDataProviderManager } from '../../tree/v2/workspace/WorkspaceResourceBranchDataProviderManager';
import { WorkspaceResourceTreeDataProvider } from '../../tree/v2/workspace/WorkspaceResourceTreeDataProvider';
import { AzureResourceProviderManager, WorkspaceResourceProviderManager } from './ResourceProviderManagers';

export function createAzureResourcesHostApi(
    azureResourceProviderManager: AzureResourceProviderManager,
    azureResourceBranchDataProviderManager: AzureResourceBranchDataProviderManager,
    azureResourcesTreeDataProvider: AzureResourceTreeDataProvider,
    workspaceResourceProviderManager: WorkspaceResourceProviderManager,
    workspaceResourceBranchDataProviderManager: WorkspaceResourceBranchDataProviderManager,
    workspaceResourcesTreeDataProvider: WorkspaceResourceTreeDataProvider): AzureResourcesHostApiInternal {

    return {
        azureResourcesTreeDataProvider,
        workspaceResourcesTreeDataProvider,

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
