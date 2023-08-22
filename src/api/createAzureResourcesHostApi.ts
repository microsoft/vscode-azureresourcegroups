/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AzExtResourceType, AzureResource, BranchDataProvider, ResourceModelBase, VSCodeRevealOptions, WorkspaceResource, WorkspaceResourceProvider } from '../../api/src/index';
import { revealResource } from '../commands/revealResource';
import { AzureResourceProvider, AzureResourcesHostApiInternal } from '../hostapi.v2.internal';
import { AzureResourceBranchDataProviderManager } from '../tree/azure/AzureResourceBranchDataProviderManager';
import { AzureResourceTreeDataProvider } from '../tree/azure/AzureResourceTreeDataProvider';
import { WorkspaceResourceBranchDataProviderManager } from '../tree/workspace/WorkspaceResourceBranchDataProviderManager';
import { WorkspaceResourceTreeDataProvider } from '../tree/workspace/WorkspaceResourceTreeDataProvider';
import { AzureResourceProviderManager, WorkspaceResourceProviderManager } from './ResourceProviderManagers';

export function createAzureResourcesHostApi(
    azureResourceProviderManager: AzureResourceProviderManager,
    azureResourceBranchDataProviderManager: AzureResourceBranchDataProviderManager,
    azureResourceTreeDataProvider: AzureResourceTreeDataProvider,
    workspaceResourceProviderManager: WorkspaceResourceProviderManager,
    workspaceResourceBranchDataProviderManager: WorkspaceResourceBranchDataProviderManager,
    workspaceResourceTreeDataProvider: WorkspaceResourceTreeDataProvider): AzureResourcesHostApiInternal {

    return {
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

        revealAzureResource: (id: string, options?: VSCodeRevealOptions) => {
            return callWithTelemetryAndErrorHandling('internalRevealAzureResource', context => {
                context.errorHandling.rethrow = true;
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.suppressReportIssue = true;
                return revealResource(context, id, options);
            });
        },
    }
}
