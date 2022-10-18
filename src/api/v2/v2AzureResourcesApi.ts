/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Environment } from '@azure/ms-rest-azure-env';
import { AzExtResourceType } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';

export interface ApplicationAuthentication {
    getSession(scopes?: string[]): vscode.ProviderResult<vscode.AuthenticationSession>;
}

/**
 * Information specific to the Subscription
 */
export interface ApplicationSubscription {
    readonly authentication: ApplicationAuthentication;
    readonly name: string;
    readonly subscriptionId: string;
    readonly environment: Environment;
    readonly isCustomCloud: boolean;
}

export interface ResourceBase {
    readonly id: string;
    readonly name: string;
}

export interface AzureResourceType {
    readonly type: string;
    readonly kinds?: string[];
}

/**
 * Represents an individual resource in Azure.
 * @remarks The `id` property is expected to be the Azure resource ID.
 */
export interface ApplicationResource extends ResourceBase {
    readonly subscription: ApplicationSubscription;
    readonly azureResourceType: AzureResourceType;
    readonly resourceType?: AzExtResourceType;
    readonly location?: string;
    readonly resourceGroup?: string;
    readonly tags?: {
        [propertyName: string]: string;
    };
}

// TODO: Can this be not exported?
export interface ResourceProvider<TResourceSource, TResource extends ResourceBase> {
    readonly onDidChangeResource?: vscode.Event<TResource | undefined>;

    /**
     * Called to supply the resources used as the basis for the resource group views.
     * @param source The source from which resources should be generated.
     */
    getResources(source: TResourceSource): vscode.ProviderResult<TResource[]>;
}

export type ApplicationResourceProvider = ResourceProvider<ApplicationSubscription, ApplicationResource>;

// TODO: Can this be combined with `unknown`?
export interface ResourceModelBase {
    readonly id?: string;
    readonly azureResourceId?: string;
    readonly portalUrl?: string;
}

// TODO: Create application/workspace specific base model types.

/**
 * Represents a branch data provider resource model as returned by a context menu command.
 * TODO: Do we use this internally?
 */
export interface WrappedResourceModel {
    /**
     * Unwraps the resource, returning the underlying branch data provider resource model.
     *
     * @remarks TODO: Should this be an async method (which might be viral for existing command implementations)?
     */
    unwrap<T extends ResourceModelBase>(): T | undefined;
}

/**
 * The interface that resource resolvers must implement
 */
export interface BranchDataProvider<TResource extends ResourceBase, TModel extends ResourceModelBase> extends vscode.TreeDataProvider<TModel> {
    /**
     * Get the children of `element`.
     *
     * @param element The element from which the provider gets children. Unlike a traditional TreeDataProvider, this will never be `undefined`.
     * @return Children of `element`.
     */
    getChildren(element: TModel): vscode.ProviderResult<TModel[]>;

    /**
     * A BranchDataProvider need not (and should not) implement this function.
     */
    getParent?: never;

    /**
     * Called to get the provider's model element for a specific resource.
     * @remarks getChildren() assumes that the provider passes a known <T> model item, or undefined when getting the root children.
     *          However, we need to be able to pass a specific application resource which may not match the <T> model hierarchy used by the provider.
     */
    getResourceItem(element: TResource): TModel | Thenable<TModel>;
}

type WorkspaceResourceType = string;

/**
 *
 */
export interface WorkspaceResource extends ResourceBase {
    readonly folder: vscode.WorkspaceFolder;
    /**
     * Used to match to a branch data provider.
     */
    readonly resourceType: WorkspaceResourceType;
}

/**
 * A provider for supplying items for the workspace resource tree (e.g., storage emulator, function apps in workspace, etc.)
 */
export type WorkspaceResourceProvider = ResourceProvider<vscode.WorkspaceFolder, WorkspaceResource>;

/**
 * The current (v2) Azure Resources extension API.
 */
export interface V2AzureResourcesApi extends AzureResourcesApiBase {
    /**
     * Registers a provider of application resources.
     * @param provider The resource provider.
     */
    registerApplicationResourceProvider(provider: ApplicationResourceProvider): vscode.Disposable;

    /**
     * Registers an application resource branch data provider.
     * @param type The Azure application resource type associated with the provider. Must be unique.
     * @param resolver The branch data provider for the resource type.
     */
    registerApplicationResourceBranchDataProvider<T extends ResourceModelBase>(type: AzExtResourceType, provider: BranchDataProvider<ApplicationResource, T>): vscode.Disposable;

    /**
     * Registers a provider of workspace resources.
     * @param provider The resource provider.
     */
    registerWorkspaceResourceProvider(provider: WorkspaceResourceProvider): vscode.Disposable;

    /**
     * Registers a workspace resource branch data provider.
     * @param type The workspace resource type associated with the provider. Must be unique.
     * @param provider The branch data provider for the resource type.
     */
    registerWorkspaceResourceBranchDataProvider<T extends ResourceModelBase>(type: WorkspaceResourceType, provider: BranchDataProvider<WorkspaceResource, T>): vscode.Disposable;
}

export interface AzureResourcesApiBase {
    readonly apiVersion: string;
}

/**
 *
 */
export interface GetApiOptions {
    readonly extensionId?: string;
}

/**
 * Exported object of the Azure Resources extension.
 */
export interface AzureResourcesApiManager {

    /**
     * Gets a specific version of the Azure Resources extension API.
     *
     * @typeparam T The type of the API.
     * @param version The version of the API to return. Defaults to the latest version.
     *
     * @returns The requested API or undefined, if not available.
     */
    getApi<T extends AzureResourcesApiBase>(versionRange: string, options?: GetApiOptions): T | undefined
}
