/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import type { Environment } from '@azure/ms-rest-azure-env';
import * as vscode from 'vscode';
import type { AzExtResourceType } from '../AzExtResourceType';
import type { BranchDataProvider, ResourceBase, ResourceModelBase } from './base';

/**
 * Represents a means of obtaining authentication data for an Azure subscription.
 */
export interface AzureAuthentication {
    /**
     * Gets a VS Code authentication session for an Azure subscription.
     * Always uses the default scope, `https://management.azure.com/.default/` and respects `microsoft-sovereign-cloud.environment` setting.
     *
     * @returns A VS Code authentication session or undefined, if none could be obtained.
     */
    getSession(): vscode.ProviderResult<vscode.AuthenticationSession>;
    /**
     * Gets a VS Code authentication session for an Azure subscription.
     *
     * @param scopes - The scopes for which the authentication is needed.
     *
     * @returns A VS Code authentication session or undefined, if none could be obtained.
     */
    getSessionWithScopes(scopes: string[]): vscode.ProviderResult<vscode.AuthenticationSession>;
}

/**
 * Represents an Azure subscription.
 */
export interface AzureSubscription {
    /**
     * Access to the authentication session associated with this subscription.
     */
    readonly authentication: AzureAuthentication;

    /**
     * The Azure environment to which this subscription belongs.
     */
    readonly environment: Environment;

    /**
     * Whether this subscription belongs to a custom cloud.
     */
    readonly isCustomCloud: boolean;

    /**
     * The display name of this subscription.
     */
    readonly name: string;

    /**
     * The ID of this subscription.
     */
    readonly subscriptionId: string;

    /**
     * The tenant to which this subscription belongs or undefined, if not associated with a specific tenant.
     */
    readonly tenantId: string;
}

/**
 * Represents a type of resource as designated by Azure.
 */
export interface AzureResourceType {
    /**
     * The kinds of resources that this type can represent.
     */
    readonly kinds?: string[];

    /**
     * The (general) type of resource.
     */
    readonly type: string;
}

/**
 * Represents an individual resource in Azure.
 */
export interface AzureResource extends ResourceBase {
    /**
     * The Azure-designated type of this resource.
     */
    readonly azureResourceType: AzureResourceType;

    /**
     * The location in which this resource exists.
     */
    readonly location?: string;

    /**
     * The resource group to which this resource belongs.
     */
    readonly resourceGroup?: string;

    /**
     * The type of this resource.
     *
     * @remarks This value is used to map resources to their associated branch data provider.
     */
    readonly resourceType?: AzExtResourceType;

    /**
     * The Azure subscription to which this resource belongs.
     */
    readonly subscription: AzureSubscription;

    /**
     * The tags associated with this resource.
     */
    readonly tags?: {
        [propertyName: string]: string;
    };

    /**
     * A copy of the raw resource.
     */
    readonly raw: {};
}

export interface ViewPropertiesModelAsync {
    /**
     * Async function to get the raw data associated with the resource to populate the properties file.
     */
    getData: () => Promise<{}>;
}

export interface ViewPropertiesModelSync {
    /**
     * Raw data associated with the resource to populate the properties file.
     */
    data: {};
}

export type ViewPropertiesModel = {
    /**
    * File name displayed in VS Code.
    */
    label: string
} & (ViewPropertiesModelAsync | ViewPropertiesModelSync);

/**
 * Represents a model of an individual Azure resource or its child items.
 */
export interface AzureResourceModel extends ResourceModelBase {
    /**
     * The Azure ID of this resource.
     *
     * @remarks This property is expected to be implemented on "application-level" resources, but may also be applicable to its child items.
     */
    readonly azureResourceId?: string;

    /**
     * The URL of the area of Azure portal related to this item.
     */
    readonly portalUrl?: vscode.Uri;

    /**
     * Define to enable the "View Properties" command.
     */
    readonly viewProperties?: ViewPropertiesModel;
}

/**
 * A provider for visualizing items in the Azure resource tree (e.g. Cosmos DB, Storage, etc.).
 */
export type AzureResourceBranchDataProvider<TModel extends AzureResourceModel> = BranchDataProvider<AzureResource, TModel>;
