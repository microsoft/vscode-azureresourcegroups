import { ISubscriptionContext } from "@microsoft/vscode-azext-utils";
import { ApplicationSubscription } from "../../api/v2/v2AzureResourcesApi";
import { ResourceGroupItem } from "./ResourceGroupItem";

export interface ResourceGroupsTreeContext {
    // TODO: Eliminate this; it's only here for existing command logic.
    readonly subscriptionContext: ISubscriptionContext;

    readonly subscription: ApplicationSubscription;

    refresh(item: ResourceGroupItem): void;
}
