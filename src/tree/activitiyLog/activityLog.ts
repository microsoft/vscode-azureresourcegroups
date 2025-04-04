/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { BranchDataProvider, ResourceBase, ResourceModelBase, ResourceProvider } from "api/src";

/**
 * Respresents a specific type of activity log resource.
 *
 * @remarks This value should be unique across all types of activity log resources.
 */
export type ActivityLogResourceType = string;

/**
 * An indivdual root resource for an activity log.
 */
export interface ActivityLogResource extends ResourceBase {
    //account?

    /**
         * The type of this resource.
         *
         * @remarks This value is used to map resources to their associated branch data provider.
         */
    readonly resourceType: ActivityLogResourceType;
}

/**
 * Represents a model of an individual activity log resource or its child items.
 */
export type ActivityLogResourceModel = ResourceModelBase;
/**
 * A provider for supplying items for the activity log resource tree
 */
export type ActivityLogResourceProvider = ResourceProvider<void, ActivityLogResource>;
/**
 * A provider for visualizing items in the activity log resource tree
 */
export type ActivityLogResourceBranchDataProvider<TModel extends ActivityLogResourceModel> = BranchDataProvider<ActivityLogResource, TModel>;
