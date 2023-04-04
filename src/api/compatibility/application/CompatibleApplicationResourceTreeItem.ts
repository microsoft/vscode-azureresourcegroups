/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeDataProvider, AzExtTreeItem, IActionContext, ISubscriptionContext, nonNullProp, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import type { ResolvedAppResourceBase } from "@microsoft/vscode-azext-utils/hostapi";
import { TreeItemCollapsibleState } from "vscode";
import { AzExtResourceType, AzureResource } from "../../../../api/src/index";
import { getIconPath } from "../../../utils/azureUtils";

/**
 * Must imitate the behavior of ResolvedAppResourceBase
 */
export class CompatibleResolvedApplicationResourceTreeItem extends AzExtParentTreeItem {
    public static contextValue: string = 'azureResource';
    protected readonly contextValues: Set<string> = new Set<string>();
    public get contextValue(): string {
        return Array.from(this.contextValues.values()).sort().join(';');
    }

    // override
    public get effectiveId(): string | undefined {
        return undefined;
    }

    public valuesToMask: string[] = [];

    public readonly resolveResult: ResolvedAppResourceBase;
    public data: AzureResource;
    public readonly azExtResourceType!: AzExtResourceType;

    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();
    public tags?: { [propertyName: string]: string; } | undefined;

    public get label(): string {
        return nonNullProp(this.data, 'name');
    }

    public get iconPath(): TreeItemIconPath {
        return getIconPath(this.data.resourceType);
    }

    public get description(): string | undefined {
        return this.resolveResult?.description;
    }

    public get collapsibleState(): TreeItemCollapsibleState | undefined {
        return this.resolveResult?.initialCollapsibleState ?? !!this.resolveResult?.loadMoreChildrenImpl ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None;
    }

    public static Create(resource: AzureResource, resolveResult: ResolvedAppResourceBase, subscription: ISubscriptionContext, treeDataProvider: AzExtTreeDataProvider, azureResource: AzureResource): CompatibleResolvedApplicationResourceTreeItem {
        const resolvable: CompatibleResolvedApplicationResourceTreeItem = new CompatibleResolvedApplicationResourceTreeItem(resource, resolveResult, subscription, treeDataProvider, azureResource);
        return createResolvableProxy(resolvable);
    }

    public readonly resource: AzureResource;

    private constructor(resource: AzureResource, resolved: ResolvedAppResourceBase, __subscription: ISubscriptionContext, __treeDataProvider: AzExtTreeDataProvider, azureResource: AzureResource) {
        super(
            (<Partial<AzExtParentTreeItem>>{
                treeDataProvider: __treeDataProvider,
                valuesToMask: [],
                subscription: __subscription,
                parent: undefined,
                removeChildFromCache: () => {
                    this.treeDataProvider.refreshUIOnly(undefined);
                },
            }) as unknown as AzExtParentTreeItem
        );

        this.resource = azureResource;
        this.resolveResult = resolved;
        this.data = resource;
        this.tags = resource.tags;

        this.contextValues.add(CompatibleResolvedApplicationResourceTreeItem.contextValue);
        if (azureResource.resourceType) {
            this.contextValues.add(azureResource.resourceType);
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

type Resolvable<T> = T & {
    resolveResult: ResolvedAppResourceBase | null | undefined;
}

export function createResolvableProxy<T extends AzExtParentTreeItem>(resolvable: Resolvable<T>): T {
    const providerHandler: ProxyHandler<Resolvable<T>> = {
        get: (target: Resolvable<T>, name: string): unknown => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            return resolvable?.resolveResult?.[name] ?? target[name];
        },
        set: (target: Resolvable<T>, name: string, value: unknown): boolean => {
            if (resolvable.resolveResult && Object.getOwnPropertyDescriptor(resolvable.resolveResult, name)?.writable) {
                // Tell TS we know the property exists and is writable
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                resolvable.resolveResult[name] = value;
                return true;
            }
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            target[name] = value;
            return true;
        },
        /**
         * Needed to be compatible with any usages of instanceof in utils/azureutils
         *
         * If resolved returns AzExtTreeItem or AzExtParentTreeItem depending on if resolveResult has loadMoreChildrenImpl defined
         * If not resolved, returns AppResourceTreeItem
         */
        getPrototypeOf: (target: Resolvable<T>): AzExtParentTreeItem | AzExtTreeItem => {
            if (resolvable?.resolveResult) {
                return resolvable.resolveResult.loadMoreChildrenImpl ? AzExtParentTreeItem.prototype : AzExtTreeItem.prototype
            }
            return target;
        }
    }
    return new Proxy(resolvable, providerHandler);
}
