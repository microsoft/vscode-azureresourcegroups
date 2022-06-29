/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ResolvedAppResourceBase } from "@microsoft/vscode-azext-utils/hostapi";
import { ext } from "../extensionVariables";
import { SubscriptionTreeItem } from "../tree/SubscriptionTreeItem";
import { getSubscriptionIdFromId } from "../utils/azureUtils";

export async function resolveAppResource(context: IActionContext, resource: ResolvedAppResourceBase): Promise<void> {
    const subId = getSubscriptionIdFromId(resource.id!);
    const subNode = await ext.appResourceTree.findTreeItem(subId, context) as SubscriptionTreeItem;

    const appResourceTreeItem = await subNode.findAppResourceByResourceId(context, resource.id!)
    await appResourceTreeItem?.resolve(false, context);
}
