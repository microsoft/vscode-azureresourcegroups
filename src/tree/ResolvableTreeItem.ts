import { GenericResource } from "@azure/arm-resources";
import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, InvalidTreeItem, nonNullProp } from "@microsoft/vscode-azext-utils";
import { ApplicationResource, ApplicationResourceResolver, GroupingConfig, ResolvableTreeItem as IResolvableTreeItem, ResolveResult } from "../api";
import { applicationResourceResolvers } from "../api/registerApplicationResourceResolver";
import { getAzureExtensions } from "../AzExtWrapper";
import { ext } from "../extensionVariables";
import { InstallableResourceTreeItem } from "./InstallableResourceTreeItem";

export abstract class ResolvableTreeItem extends AzExtTreeItem implements ApplicationResource, IResolvableTreeItem {

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public groupConfig: GroupingConfig;

    public resolveResult: ResolveResult | undefined | null;

    public treeItem: AzExtTreeItem | undefined;

    public data: GenericResource;

    public async loadMoreChildrenImpl(clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        await this.resolve(clearCache, context);
        if (this.treeItem && this.treeItem instanceof AzExtParentTreeItem) {
            return await this.treeItem.loadMoreChildrenImpl(clearCache, context);
        } else {
            return [];
        }
    }

    public async resolve(clearCache: boolean, context: IActionContext): Promise<ResolveResult> {

        const resolver = this.getResolver();

        if (!resolver) {
            return {
                treeItem: () => new InvalidTreeItem(this.parent!, new Error('No resolver'), {
                    label: 'No resolver',
                    contextValue: 'noResolver',
                })
            }
        }


        await this.runWithTemporaryDescription(context, 'Resolving...', async () => {
            if (!this.resolveResult || clearCache) {
                this.resolveResult = await resolver?.resolveResource(this.subscription, this.data);
            }

        });

        if (!this.resolveResult) {
            throw new Error('Failed to resolve tree item');
        }

        ext.activationManager.onNodeTypeResolved(nonNullProp(this.data, 'type'));
        this.treeItem = this.resolveResult.treeItem(this.parent!);
        this.groupConfig = this.resolveResult.groupConfig ?? this.groupConfig;
        this.description = this.resolveResult.description ?? this.description;
        this.contextValue = this.resolveResult.contextValue ?? this.contextValue;

        return this.resolveResult;
    }

    private getResolver(): ApplicationResourceResolver | undefined {
        const resolver = applicationResourceResolvers[nonNullProp(this.data, 'type')];
        if (resolver) {
            return resolver;
        }

        const azExts = getAzureExtensions();

        const extension = azExts.find((azExt) => azExt.matchesResourceType(this.data));
        if (!extension) {
            throw Error(`No extension found for ${this.data.type}`);
        }

        return {
            resolveResource: async (_sub, resource): Promise<ResolveResult> => {
                return {
                    treeItem: (parent) => new InstallableResourceTreeItem(parent, resource, extension),
                }
            }
        }
    }
}
