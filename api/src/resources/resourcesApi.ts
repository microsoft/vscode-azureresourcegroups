/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { AzExtResourceType } from "../AzExtResourceType";
import { AzureResourceBranchDataProvider, AzureResourceModel } from "./azure";
import { ResourceModelBase } from "./base";
import { WorkspaceResourceBranchDataProvider, WorkspaceResourceModel, WorkspaceResourceProvider, WorkspaceResourceType } from "./workspace";

// scope down vscode.TreeDataProvider to exactly what's allowed to be used
export type ResourceGroupsTreeDataProvider = Pick<vscode.TreeDataProvider<unknown>, 'getChildren' | 'getTreeItem'>;

export type VSCodeRevealOptions = Parameters<vscode.TreeView<unknown>['reveal']>['1'];

export interface AzureResourceRevealOptions {
    /** Restrict subscription resolution to this tenant, including delegated subscriptions. */
    tenantId?: string;
    /** Keep the target subscription visible for this window's session without changing saved filters. */
    includeFilteredSubscription?: boolean;
    revealOptions?: VSCodeRevealOptions;
}

export interface AzureResourceRevealResult {
    /** Fully qualified tree ID, including the selected account and tenant. */
    id: string;
    /** The exact provider model that was resolved, when the target belongs to a branch provider. */
    resource?: ResourceModelBase;
}

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
     * Resolve an Azure resource, then request its reveal in VS Code.
     * Returns its fully qualified tree node ID and the exact provider model, when available.
     * Prompts for sign-in if no Azure account is signed in. Returns undefined on cancellation.
     * Rejects if explicit resource loading or the VS Code reveal request fails.
     * Independent background tree rendering does not affect the result.
     * Multiple matching accounts/tenants are offered in a picker.
     * Requires a host exposing this method; older hosts only support {@link revealAzureResource}.
     */
    revealAzureResourceWithResult(id: string, options?: AzureResourceRevealOptions): Promise<AzureResourceRevealResult | undefined>;

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
     * @param resourceGroupId - The Azure Resource Group ID to focus on, in the form
     *   `/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}`.
     *   The promise is rejected with an error if the ID is not in the expected format.
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
