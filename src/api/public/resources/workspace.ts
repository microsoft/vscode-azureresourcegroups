/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { BranchDataProvider, ResourceBase, ResourceModelBase, ResourceProvider } from './base';

/**
 * Respresents a specific type of workspace resource.
 *
 * @remarks This value should be unique across all types of workspace resources.
 */
export type WorkspaceResourceType = string;

/**
 * An indivdual root resource for a workspace.
 */
export interface WorkspaceResource extends ResourceBase {
    /**
     * The folder to which this resource belongs.
     * Leave undefined if this resource is a global or system-level resource
     * not associated with a specific workspace folder.
     */
    readonly folder?: vscode.WorkspaceFolder;
    /**
     * The type of this resource.
     *
     * @remarks This value is used to map resources to their associated branch data provider.
     */
    readonly resourceType: WorkspaceResourceType;
}
/**
 * Represents a model of an individual workspace resource or its child items.
 */
export type WorkspaceResourceModel = ResourceModelBase;
/**
 * A provider for supplying items for the workspace resource tree (e.g., storage emulator, function apps in workspace, etc.).
 */
export type WorkspaceResourceProvider = ResourceProvider<void, WorkspaceResource>;
/**
 * A provider for visualizing items in the workspace resource tree (e.g., storage emulator, function apps in workspace, etc.).
 */
export type WorkspaceResourceBranchDataProvider<TModel extends WorkspaceResourceModel> = BranchDataProvider<WorkspaceResource, TModel>;
