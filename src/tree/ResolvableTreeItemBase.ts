/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, IActionContext } from "@microsoft/vscode-azext-utils";
import { AppResource, AppResourceResolver, GroupableResource, GroupingConfig, ResolvedAppResourceBase } from "@microsoft/vscode-azext-utils/hostapi";
import { TreeItemCollapsibleState } from "vscode";
import { applicationResourceResolvers } from "../api/registerApplicationResourceResolver";
import { ext } from "../extensionVariables";
import { isBuiltinResolver } from "../resolvers/BuiltinResolver";
import { installableAppResourceResolver } from "../resolvers/InstallableAppResourceResolver";
import { outdatedAppResourceResolver } from "../resolvers/OutdatedAppResourceResolver";
import { shallowResourceResolver } from "../resolvers/ShallowResourceResolver";
import { wrapperResolver } from "../resolvers/WrapperResolver";
import { localize } from "../utils/localize";

const loading = localize('loading', "Loading...");

export abstract class ResolvableTreeItemBase extends AzExtParentTreeItem implements GroupableResource {
    public groupConfig: GroupingConfig;
    public resolveResult: ResolvedAppResourceBase | undefined | null;
    public data: AppResource;
    protected readonly contextValues: Set<string> = new Set<string>();
    public abstract parent?: AzExtParentTreeItem | undefined;
    public abstract fullId: string;

    // Setting this forces the tree item to always start out with a spinner icon, and have a "Loading..." description
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    private _temporaryDescription: string | undefined = loading;

    public get contextValue(): string {
        return Array.from(this.contextValues.values()).sort().join(';');
    }

    public get description(): string | undefined {
        return this.resolveResult?.description;
    }

    public override get collapsibleState(): TreeItemCollapsibleState | undefined {
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

    public async refreshImpl(context: IActionContext): Promise<void> {
        await this.resolve(true, context);
    }

    public async resolve(clearCache: boolean, context: IActionContext): Promise<void> {
        if (!this.resolveResult || clearCache) {
            ext.activationManager.onNodeTypeResolved(this.data.type);

            const resolver = this.getResolver();

            await this.runWithTemporaryDescription(context, {
                description: loading,
                softRefresh: true
            }, async () => {
                this.resolveResult = await resolver.resolveResource(this.subscription, this.data);

                // Debug only?
                if (!this.resolveResult) {
                    throw new Error('Failed to resolve tree item');
                }

                this.resolveResult.contextValuesToAdd?.forEach(cv => this.contextValues.add(cv));
            });

            const disposable = ext.events.onDidRegisterResolver(async (resolver: AppResourceResolver) => {
                if (resolver.matchesResource(this.data)) {
                    disposable.dispose();
                    await this.refresh(context);
                } else {
                    // If it doesn't match; do nothing and also don't dispose of the event listener
                }
            });

            // It is not needed to refresh at this point, because `runWithTemporaryDescription` already does that
        }
    }

    private getResolver(): AppResourceResolver {
        const resolver: AppResourceResolver | undefined =
            Object.values(applicationResourceResolvers).find(r => r.matchesResource(this.data) && !isBuiltinResolver(r));

        if (resolver) {
            return resolver;
        } else if (outdatedAppResourceResolver.matchesResource(this.data)) {
            return outdatedAppResourceResolver;
        } else if (wrapperResolver.matchesResource(this.data)) {
            return wrapperResolver;
        } else if (installableAppResourceResolver.matchesResource(this.data)) {
            return installableAppResourceResolver;
        } else {
            return shallowResourceResolver;
        }
    }
}
