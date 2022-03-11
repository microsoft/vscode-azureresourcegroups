/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, nonNullProp } from "@microsoft/vscode-azext-utils";
import { AppResource, AppResourceResolver, GroupableResource, GroupingConfig, ResolvedAppResourceBase } from "../api";
import { applicationResourceResolvers } from "../api/registerApplicationResourceResolver";
import { ext } from "../extensionVariables";
import { installableAppResourceResolver } from "../resolvers/InstallableAppResourceResolver";
import { noopResolver } from "../resolvers/NoopResolver";
import { shallowResourceResolver } from "../resolvers/ShallowResourceResolver";

export abstract class ResolvableTreeItemBase extends AzExtParentTreeItem implements GroupableResource {

    public groupConfig: GroupingConfig;
    public resolveResult: ResolvedAppResourceBase | undefined | null;
    public data: AppResource;
    protected readonly contextValues: Set<string> = new Set<string>();

    public get contextValue(): string {
        return Array.from(this.contextValues.values()).sort().join(';');
    }

    public async loadMoreChildrenImpl(clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        await this.resolve(clearCache, context);
        if (this.resolveResult && this.resolveResult.loadMoreChildrenImpl) {
            return await this.resolveResult.loadMoreChildrenImpl(clearCache, context);
        } else {
            return [];
        }
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async resolve(clearCache: boolean, context: IActionContext): Promise<void> {
        ext.activationManager.onNodeTypeResolved(this.data.type);

        const resolver = this.getResolver();

        await this.runWithTemporaryDescription(context, 'Loading...', async () => {
            if (!this.resolveResult || clearCache) {
                this.resolveResult = await resolver.resolveResource(this.subscription, this.data);
            }

            // Debug only?
            if (!this.resolveResult) {
                throw new Error('Failed to resolve tree item');
            }

            this.resolveResult?.contextValuesToAdd?.forEach(cv => this.contextValues.add(cv));

            await this.refresh(context); // refreshUIOnly?
        });
    }

    private getResolver(): AppResourceResolver {
        const resolver = applicationResourceResolvers[nonNullProp(this.data, 'type')];
        if (resolver) {
            return resolver;
        } else if (noopResolver.isApplicable(this.data)) {
            return noopResolver;
        } else if (installableAppResourceResolver.isApplicable(this.data)) {
            return installableAppResourceResolver;
        }

        return shallowResourceResolver;
    }
}
