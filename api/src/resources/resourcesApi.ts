/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { AzExtResourceType } from "../AzExtResourceType";
import { AzureResourceBranchDataProvider, AzureResourceModel } from "./azure";
import { WorkspaceResourceBranchDataProvider, WorkspaceResourceModel, WorkspaceResourceProvider, WorkspaceResourceType } from "./workspace";

// scope down vscode.TreeDataProvider to exactly what's allowed to be used
export type ResourceGroupsTreeDataProvider = Pick<vscode.TreeDataProvider<unknown>, 'getChildren' | 'getTreeItem'>;

export type VSCodeRevealOptions = Parameters<vscode.TreeView<unknown>['reveal']>['1'];

export interface ResourcesApi {
    /**
     * {@link vscode.TreeDataProvider} representing the Azure tree view.
     */
    readonly azureResourceTreeDataProvider: ResourceGroupsTreeDataProvider;

    /**
     * Registers an Azure resource branch data provider.
     *
     * @param type - The Azure resource type associated with the provider. Must be unique.
     * @param resolver - The branch data provider for the resource type.
     *
     * @returns A disposable that unregisters the provider.
     */
    registerAzureResourceBranchDataProvider<TModel extends AzureResourceModel>(type: AzExtResourceType, provider: AzureResourceBranchDataProvider<TModel>): vscode.Disposable;

    /**
     * {@link vscode.TreeDataProvider} representing the Workspace tree view.
     */
    readonly workspaceResourceTreeDataProvider: ResourceGroupsTreeDataProvider;

    /**
     * Registers a provider of workspace resources.
    *
    * @param provider - The resource provider.
    *
    * @returns A disposable that unregisters the provider.
    */
    registerWorkspaceResourceProvider(provider: WorkspaceResourceProvider): vscode.Disposable;

    /**
     * Registers a workspace resource branch data provider.
    *
    * @param type - The workspace resource type associated with the provider. Must be unique.
    * @param provider - The branch data provider for the resource type.
    *
    * @returns A disposable that unregisters the provider.
    */
    registerWorkspaceResourceBranchDataProvider<TModel extends WorkspaceResourceModel>(type: WorkspaceResourceType, provider: WorkspaceResourceBranchDataProvider<TModel>): vscode.Disposable;

    /**
     * Reveal a resource in the Azure tree view. Works with subscriptions, resource groups, or resources.
     *
     * @param id - The Azure Resource ID to reveal in the Azure tree view.
     * @param options - Options for revealing the resource. See {@link vscode.TreeView.reveal}
     */
    revealAzureResource(id: string, options?: VSCodeRevealOptions): Promise<void>;

    /**
     * Reveal a resource in the Workspace tree view.
     *
     * @param id - The Workspace Resource ID to reveal in the Workspace tree view.
     * @param options - Options for revealing the resource. See {@link vscode.TreeView.reveal}
     */
    revealWorkspaceResource(id: string, options?: VSCodeRevealOptions): Promise<void>;

    /**
     * Focus on a resource group in the Focused Resources view.
     * This opens the Focused Resources view and filters it to show only resources from the specified resource group.
     *
     * @param resourceGroupId - The Azure Resource Group ID to focus on.
     */
    focusResourceGroup(resourceGroupId: string): Promise<void>;

    /**
     * Gets a list of node IDs for nodes recently used/interacted with in the Azure tree view.
     *
     * @returns A promise that resolves to a list of node IDs.
     */
    getRecentlyUsedAzureNodes(): Promise<string[]>;

    /**
     * Gets the node ID for the currently selected Azure node in the Azure tree view.
     *
     * @returns A promise that resolves to the node ID or undefined if no node is selected.
     */
    getSelectedAzureNode(): Promise<string | undefined>;
}
