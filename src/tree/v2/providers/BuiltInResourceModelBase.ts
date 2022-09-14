import { FindableByIdTreeNodeV2 } from "@microsoft/vscode-azext-utils";
import { ResourceModelBase } from "../../../api/v2/v2AzureResourcesApi";
import { ResourceGroupsItem } from "../ResourceGroupsItem";

export interface BuiltInResourceModelBase extends Required<FindableByIdTreeNodeV2>, ResourceModelBase, ResourceGroupsItem {
    id: string;
    quickPickOptions: {
        contextValues: string[];
        isLeaf: boolean;
    };
}
