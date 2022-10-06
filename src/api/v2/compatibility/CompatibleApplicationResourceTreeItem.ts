/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtResourceType, AzExtTreeDataProvider, AzExtTreeItem, IActionContext, ISubscriptionContext, nonNullProp, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import type { AppResource, ResolvedAppResourceBase } from "@microsoft/vscode-azext-utils/hostapi";
import { TreeItemCollapsibleState } from "vscode";
import { createResolvableProxy } from "../../../tree/AppResourceTreeItem";
import { getIconPath } from "../../../utils/azureUtils";
import { ApplicationResource } from "../v2AzureResourcesApi";

/**
 * Must immitate the behavior of AppResourceTreeItem
 */
export class CompatibleResolvedApplicationResourceTreeItem extends AzExtParentTreeItem {
    public static contextValue: string = 'azureResource';
    protected readonly contextValues: Set<string> = new Set<string>();
    public get contextValue(): string {
        return Array.from(this.contextValues.values()).sort().join(';');
    }

    public valuesToMask: string[] = [];

    public readonly resolveResult: ResolvedAppResourceBase;
    public data: AppResource;
    public readonly azExtResourceType: AzExtResourceType;

    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();
    public tags?: { [propertyName: string]: string; } | undefined;

    public get id(): string {
        return nonNullProp(this.data, 'id');
    }

    public get label(): string {
        return nonNullProp(this.data, 'name');
    }

    public get iconPath(): TreeItemIconPath {
        return getIconPath(this.data.azExtResourceType);
    }

    public get description(): string | undefined {
        return this.resolveResult?.description;
    }

    public get collapsibleState(): TreeItemCollapsibleState | undefined {
        return this.resolveResult?.initialCollapsibleState ?? !!this.resolveResult?.loadMoreChildrenImpl ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None;
    }

    public static Create(resource: AppResource, resolveResult: ResolvedAppResourceBase, subscription: ISubscriptionContext, treeDataProvider: AzExtTreeDataProvider, applicationResource: ApplicationResource): CompatibleResolvedApplicationResourceTreeItem {
        const resolvable: CompatibleResolvedApplicationResourceTreeItem = new CompatibleResolvedApplicationResourceTreeItem(resource, resolveResult, subscription, treeDataProvider, applicationResource);
        return createResolvableProxy(resolvable);
    }

    public readonly resource: ApplicationResource;

    private constructor(resource: AppResource, resolved: ResolvedAppResourceBase, __subscription: ISubscriptionContext, __treeDataProvider: AzExtTreeDataProvider, applicationResource: ApplicationResource) {
        super(
            (<Partial<AzExtParentTreeItem>>{
                treeDataProvider: __treeDataProvider,
                valuesToMask: [],
                subscription: __subscription,
                parent: undefined,
            }) as unknown as AzExtParentTreeItem
        );

        this.resource = applicationResource;
        this.resolveResult = resolved;
        this.data = resource;
        this.tags = resource.tags;

        this.contextValues.add(CompatibleResolvedApplicationResourceTreeItem.contextValue);
        if (applicationResource.azExtResourceType) {
            this.contextValues.add(applicationResource.azExtResourceType);
        }
        resolved.contextValuesToAdd?.forEach((value: string) => this.contextValues.add(value));
    }

    public async loadMoreChildrenImpl(clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        if (this.resolveResult?.loadMoreChildrenImpl) {
            // this is actually calling resolveResult.loadMoreChildrenImpl through the Proxy so that the function has the correct thisArg
            return await this.loadMoreChildrenImpl(clearCache, context);
        } else {
            return [];
        }
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async refreshImpl(): Promise<void> {
        this.mTime = Date.now();
    }
}


