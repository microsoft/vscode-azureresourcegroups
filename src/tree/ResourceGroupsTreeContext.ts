/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISubscriptionContext } from "@microsoft/vscode-azext-utils";
import { AzureSubscription } from "../../api/src/index";
import { ResourceGroupsItem } from "./ResourceGroupsItem";

export interface ResourceGroupsTreeContext {

    readonly subscription: AzureSubscription;

    // TODO: Eliminate this; it's only here for existing command logic.
    readonly subscriptionContext: ISubscriptionContext;

    refresh(item: ResourceGroupsItem): void;
}
