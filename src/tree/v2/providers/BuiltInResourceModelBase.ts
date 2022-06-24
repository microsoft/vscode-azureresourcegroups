import { ResourceModelBase } from "../../../api/v2/v2AzureResourcesApi";
import { ResourceGroupItem } from "../ResourceGroupItem";

export interface BuiltInResourceModelBase extends ResourceModelBase, ResourceGroupItem {
}
