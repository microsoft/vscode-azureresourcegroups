import { ISubscriptionContext } from "@microsoft/vscode-azext-utils";
import { ResourceGroupsItem } from "./ResourceGroupsItem";

export interface ResourceGroupsTreeContext {
    /**
     * TODO: Eliminate this; it's only here for existing command logic.
     * @deprecated
     */
    readonly subscriptionContext: ISubscriptionContext;

    getParent(item: ResourceGroupsItem): ResourceGroupsItem | undefined;

    refresh(item: ResourceGroupsItem): void;
}
