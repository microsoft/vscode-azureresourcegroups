/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtResourceType, AzExtTreeDataProvider, AzExtTreeItem, IActionContext, ISubscriptionContext, nonNullProp, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import type { AppResource, ResolvedAppResourceBase } from "@microsoft/vscode-azext-utils/hostapi";
import { TreeItemCollapsibleState } from "vscode";
import { getIconPath } from "../../../utils/azureUtils";

export class CompatTreeItem extends AzExtParentTreeItem {

    public resolveResult: ResolvedAppResourceBase | undefined | null;
    public data: AppResource;
    protected readonly contextValues: Set<string> = new Set<string>();

    public get contextValue(): string {
        return Array.from(this.contextValues.values()).sort().join(';');
    }

    public valuesToMask: string[] = [];

    public static contextValue: string = 'azureResource';

    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    public type: string;
    public kind?: string | undefined;
    public azExtResourceType: AzExtResourceType;
    public location?: string | undefined;
    public tags?: { [propertyName: string]: string; } | undefined;

    public isHidden: boolean;

    private constructor(resource: AppResource, resolved: ResolvedAppResourceBase, __subscription: ISubscriptionContext, __treeDataProvider: AzExtTreeDataProvider) {
        const fakeParent: Partial<AzExtParentTreeItem> = {
            treeDataProvider: __treeDataProvider,
            valuesToMask: [],
            subscription: __subscription,
            parent: undefined,
        };

        super(fakeParent as unknown as AzExtParentTreeItem);

        this.resolveResult = resolved;

        this.data = resource;

        this.contextValues.add(CompatTreeItem.contextValue);
        resolved.contextValuesToAdd?.forEach((value: string) => this.contextValues.add(value));

        this.type = resource.type;
        this.kind = resource.kind;
        this.location = resource.location;
        this.tags = resource.tags;
    }

    public static Create(resource: AppResource, resolveResult: ResolvedAppResourceBase, subscription: ISubscriptionContext, treeDataProvider: AzExtTreeDataProvider): CompatTreeItem {
        const resolvable: CompatTreeItem = new CompatTreeItem(resource, resolveResult, subscription, treeDataProvider);
        const providerHandler: ProxyHandler<CompatTreeItem> = {
            get: (target: CompatTreeItem, name: string): unknown => {
                return resolvable?.resolveResult?.[name] ?? target[name];
            },
            set: (target: CompatTreeItem, name: string, value: unknown): boolean => {
                if (resolvable.resolveResult && Object.getOwnPropertyDescriptor(resolvable.resolveResult, name)?.writable) {
                    resolvable.resolveResult[name] = value;
                    return true;
                }
                target[name] = value;
                return true;
            },
            /**
             * Needed to be compatible with any usages of instanceof in utils/azureutils
             *
             * If resolved returns AzExtTreeItem or AzExtParentTreeItem depending on if resolveResult has loadMoreChildrenImpl defined
             * If not resolved, returns AppResourceTreeItem
             */
            getPrototypeOf: (target: CompatTreeItem): CompatTreeItem | AzExtParentTreeItem | AzExtTreeItem => {
                if (resolvable?.resolveResult) {
                    return resolvable.resolveResult.loadMoreChildrenImpl ? AzExtParentTreeItem.prototype : AzExtTreeItem.prototype
                }
                return target;
            }
        }
        return new Proxy(resolvable, providerHandler);
    }

    public get description(): string | undefined {
        return this.resolveResult?.description;
    }

    public get collapsibleState(): TreeItemCollapsibleState | undefined {
        return this.resolveResult?.initialCollapsibleState ?? !!this.resolveResult?.loadMoreChildrenImpl ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None;
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

    public get name(): string {
        return nonNullProp(this.data, 'name');
    }

    public get id(): string {
        return nonNullProp(this.data, 'id');
    }

    public get label(): string {
        return this.name;
    }

    public get iconPath(): TreeItemIconPath {
        return getIconPath(this.data.azExtResourceType);
    }

    public async refreshImpl(): Promise<void> {
        this.mTime = Date.now();
    }
}


