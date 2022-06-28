import { ResourceModelBase } from "../../../api/v2/v2AzureResourcesApi";
import { ResourceGroupsItem } from "../ResourceGroupsItem";

export interface BuiltInResourceModelBase extends ResourceModelBase, ResourceGroupsItem {
}
