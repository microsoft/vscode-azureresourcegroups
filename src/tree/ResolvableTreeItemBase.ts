/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, nonNullProp, nonNullValue } from "@microsoft/vscode-azext-utils";
import { ThemeIcon } from "vscode";
import { AppResource, AppResourceResolver, GroupableResource, GroupingConfig, ResolvedAppResourceTreeItemBase } from "../api";
import { applicationResourceResolvers } from "../api/registerApplicationResourceResolver";
import { getAzureExtensions } from "../AzExtWrapper";
import { ext } from "../extensionVariables";
import { InstallableResourceTreeItem } from "./InstallableResourceTreeItem";

export abstract class ResolvableTreeItemBase extends AzExtParentTreeItem implements GroupableResource {

    public groupConfig: GroupingConfig;
    public resolveResult: ResolvedAppResourceTreeItemBase | undefined | null;
    public data: AppResource;

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

        const resolver = this.getResolver();

        if (!resolver) {
            this.resolveResult = {
                id: this.data.id,
                contextValue: 'noResolver',
                label: 'No resolver',
                description: 'No resolver found for this resource',
                iconPath: new ThemeIcon('error'),
            }
        }

        await this.runWithTemporaryDescription(context, 'Loading...', async () => {
            if (!this.resolveResult || clearCache) {
                this.resolveResult = await resolver?.resolveResource(this.subscription, this.data);
            }
        });

        if (!this.resolveResult) {
            throw new Error('Failed to resolve tree item');
        }

        ext.activationManager.onNodeTypeResolved(nonNullProp(this.data, 'type'));
    }

    private getResolver(): AppResourceResolver | undefined {
        const resolver = applicationResourceResolvers[nonNullProp(this.data, 'type')];
        if (resolver) {
            return resolver;
        }

        const azExts = getAzureExtensions();

        const extension = azExts.find((azExt) => azExt.matchesResourceType(this.data));
        if (!extension) {
            throw Error(`No extension found for ${this.data.type}`);
        }

        const installable = new InstallableResourceTreeItem(nonNullValue(this.parent), this.data, extension);
        return {
            resolveResource: () => ({
                id: this.data.id,
                contextValue: installable.contextValue,
                description: installable.description,
                iconPath: installable.iconPath,
                label: installable.label,
                loadMoreChildrenImpl: installable.loadMoreChildrenImpl,
            })
        }
    }
}
