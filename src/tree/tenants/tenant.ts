/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { BranchDataProvider, ResourceBase, ResourceModelBase, ResourceProvider } from "api/src";

/**
 * Respresents a specific type of tenant resource.
 *
 * @remarks This value should be unique across all types of tenant resources.
 */
export type TenantResourceType = string;

/**
 * An indivdual root resource for a tenant.
 */
export interface TenantResource extends ResourceBase {
    //account?

    /**
         * The type of this resource.
         *
         * @remarks This value is used to map resources to their associated branch data provider.
         */
    readonly resourceType: TenantResourceType;
}

/**
 * Represents a model of an individual tenant resource or its child items.
 */
export type TenantResourceModel = ResourceModelBase;
/**
 * A provider for supplying items for the tenant resource tree
 */
export type TenantResourceProvider = ResourceProvider<void, TenantResource>;
/**
 * A provider for visualizing items in the workspace resource tree
 */
export type TenantResourceBranchDataProvider<TModel extends TenantResourceModel> = BranchDataProvider<TenantResource, TModel>;
