/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISubscriptionContext } from "@microsoft/vscode-azext-utils";
import { ResourceGroupsItem } from "./ResourceGroupsItem";
import { ResourceGroupsItemCache } from "./ResourceGroupsItemCache";

export interface ResourceGroupsTreeContext {
    // TODO: Eliminate this; it's only here for existing command logic.
    readonly subscriptionContext: ISubscriptionContext;

    getParent(item: ResourceGroupsItem): ResourceGroupsItem | undefined;

    refresh(item: ResourceGroupsItem): void;

    itemCache: ResourceGroupsItemCache;
}
