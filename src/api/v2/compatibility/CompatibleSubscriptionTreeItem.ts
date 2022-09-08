/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SubscriptionTreeItemBase } from "@microsoft/vscode-azext-azureutils";
import { AzExtParentTreeItem, AzExtTreeItem, IActionContext } from "@microsoft/vscode-azext-utils";
import { ApplicationSubscription } from "../../../api/v2/v2AzureResourcesApi";
import { createSubscriptionContext } from "../../../utils/v2/credentialsUtils";

/**
 * An intermediate class that exists just to redeclare `parent` as abstract, so that it
 * can be re-redeclared as an accessor in {@link CompatibleSubscriptionTreeItem} below
 */
abstract class IntermediateCompatibleSubscriptionTreeItem extends SubscriptionTreeItemBase {
    public abstract readonly parent: AzExtParentTreeItem;
}

export class CompatibleSubscriptionTreeItem extends IntermediateCompatibleSubscriptionTreeItem {
    private constructor(subscription: ApplicationSubscription) {
        super(undefined as unknown as AzExtParentTreeItem, createSubscriptionContext(subscription));
    }

    public override get parent(): AzExtParentTreeItem {
        throw new Error('This method should never be called');
    }

    public loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        throw new Error('This method should never be called');
    }

    public hasMoreChildrenImpl(): boolean {
        throw new Error('This method should never be called');
    }
}
