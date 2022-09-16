import { isAzExtTreeItem } from "@microsoft/vscode-azext-utils";
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from "../../../api/v2/v2AzureResourcesApi";
import { BranchDataItem, BranchDataItemOptions } from "../BranchDataItem";
import { CompatibleBranchDataItem } from "../CompatibleBranchDataItem";
import { ResourceGroupsItemCache } from "../ResourceGroupsItemCache";

export type BranchDataItemFactory = (branchItem: ResourceModelBase, branchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>, options?: BranchDataItemOptions) => BranchDataItem;

export function createBranchDataItemFactory(itemCache: ResourceGroupsItemCache): BranchDataItemFactory {
    return (branchItem, branchDataProvider, options) => {
        return isAzExtTreeItem(branchItem) ? new CompatibleBranchDataItem(branchItem, branchDataProvider, itemCache, options) : new BranchDataItem(branchItem, branchDataProvider, itemCache, options);
    }
}
