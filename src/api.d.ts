/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeDataProvider, AzExtTreeItem, IActionContext, ISubscriptionContext, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';

// Unresolved data that we turn into a tree item
// Subsequently this gets turned into an `AppResourceTreeItem` by RG extension
export interface AppResource {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly kind?: string;
    readonly location?: string;
    /* add more properties from GenericResource if needed */
}

export interface GroupNodeConfiguration {
    readonly label: string;
    readonly id: string;
    // label for GroupBy Configurations
    readonly keyLabel?: string;
    readonly description?: string;
    readonly icon?: vscode.ThemeIcon;
    readonly contextValue?: string;
}

export interface GroupingConfig {
    readonly resourceGroup: GroupNodeConfiguration;
    readonly resourceType: GroupNodeConfiguration;
    [label: string]: GroupNodeConfiguration; // Don't need to support right off the bat but we can put it in the interface
}

export interface GroupableResource {
    readonly groupConfig: GroupingConfig;
}


export interface ResolvableTreeItem {
    readonly data: AppResource;
    resolve(clearCache: boolean, context: IActionContext): Promise<void>;
}

export interface ApplicationResourceProvider {
    provideResources(subContext: ISubscriptionContext): vscode.ProviderResult<AppResource[] | undefined>;
}

export interface ApplicationResourceResolver {
    resolveResource(subContext: ISubscriptionContext, resource: AppResource): vscode.ProviderResult<ResolvedAppResourceTreeItemBase>;
}

export interface LocalResourceProvider {
    provideResources(): vscode.ProviderResult<LocalResource[] | undefined>;
}

// called from a resource extension (SWA, Functions, etc)
export declare function registerApplicationResourceResolver(
    provider: ApplicationResourceResolver,
    resourceType: string,
    resourceKind?: string,
): vscode.Disposable;

// Resource Groups can have a default resolve() method that it supplies, that will activate the appropriate extension and give it a chance to replace the resolve() method
// ALSO, it will eliminate that default resolver from future calls for that resource type

// called from host extension (Resource Groups)
// Will need a manifest of extensions mapping type => extension ID
export declare function registerApplicationResourceProvider(provider: ApplicationResourceProvider): vscode.Disposable;

// resource extensions need to activate onView:localResourceView and call this
export declare function registerLocalResourceProvider(
    resourceType: string,
    provider: LocalResourceProvider
): vscode.Disposable;

// AzExtTreeItem stuff we don't want people to overwrite, but are accessible
// AzExtTreeItemApi, AzExtTreeItemProtected, AzExtTreeItemReserved, *SealedAzExtTreeItem*
// AzExtTreeItem will implement this interface
export interface /*Walrused*/ /*Ottered*/ SealedAzExtTreeItem {
    refresh(): Promise<void>;
    /**
     * This id represents the effective/serializable full id of the item in the tree. It always starts with the parent's fullId and ends with either the AzExtTreeItem.id property (if implemented) or AzExtTreeItem.label property
     * This is used for AzureTreeDataProvider.findTreeItem and openInPortal
     */
    readonly fullId: string;
    readonly parent?: AzExtParentTreeItem;
    readonly treeDataProvider: AzExtTreeDataProvider;

    /**
     * The subscription information for this branch of the tree
     * Throws an error if this branch of the tree is not actually for Azure resources
     */
    readonly subscription: ISubscriptionContext;

    /**
     * Values to mask in error messages whenever an action uses this tree item
     * NOTE: Some values are automatically masked without the need to add anything here, like the label and parts of the id if it's an Azure id
     */
    readonly valuesToMask: string[];

    /**
     * Set to true if the label of this tree item does not need to be masked
     */
    suppressMaskLabel?: boolean;
}

// AzExtTreeItem stuff we need them to implement

/**
 * AzExtTreeItem methods that are to be implemented by the base class
 * copied from utils/index.d.ts AzExtTreeItem
 */
export interface AbstractAzExtTreeItem {

    id: string;
    label: string;

    /**
     * Additional information about a tree item that is appended to the label with the format `label (description)`
     */
    description: string | undefined;

    iconPath: TreeItemIconPath | undefined;
    commandId?: string;
    tooltip?: string;

    /**
     * The arguments to pass in when executing `commandId`. If not specified, this tree item will be used.
     */
    commandArgs?: unknown[];
    contextValue: string;

    /**
      * Implement this to display child resources. Should not be called directly
      * @param clearCache If true, you should start the "Load more..." process over
      * @param context The action context
      */
    loadMoreChildrenImpl?(clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]>;


    /**
     * Implement this to support the 'delete' action in the tree. Should not be called directly
     */
    deleteTreeItemImpl?(context: IActionContext): Promise<void>;

    /**
     * Implement this to execute any async code when this node is refreshed. Should not be called directly
     */
    refreshImpl?(context: IActionContext): Promise<void>;

    /**
     * Optional function to filter items displayed in the tree picker. Should not be called directly
     * If not implemented, it's assumed that 'isAncestorOf' evaluates to true
     */
    isAncestorOfImpl?(contextValue: string | RegExp): boolean;
}

export type ResolvedAppResourceTreeItemBase = Partial<{ [P in keyof SealedAzExtTreeItem]: never }> & AbstractAzExtTreeItem;

export type ResolvedItem = ResolvedAppResourceTreeItemBase

export type ResolvedAppResourceTreeItem<T extends ResolvedAppResourceTreeItemBase> = AppResource & Omit<T, keyof ResolvedAppResourceTreeItemBase>;

export type LocalResource = AzExtTreeItem;

// Not part of public interface to start with--only Resource Groups extension will call it (for now)
// currently implemented as AzureResourceProvider
export interface AppResourceProvider {
    provideResources(
        subContext: ISubscriptionContext
    ): vscode.ProviderResult<AppResource[]>;
}

export interface AppResourceResolver {
    // return null to explicitly skip this resource
    resolveResource(
        subContext: ISubscriptionContext,
        resource: AppResource
    ): Promise<ResolvedAppResourceTreeItemBase | null> | ResolvedAppResourceTreeItemBase;
}
