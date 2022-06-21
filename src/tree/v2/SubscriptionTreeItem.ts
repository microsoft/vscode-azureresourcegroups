/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SubscriptionTreeItemBase } from '@microsoft/vscode-azext-azureutils';
import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, ISubscriptionContext } from '@microsoft/vscode-azext-utils';

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
    public constructor(parent: AzExtParentTreeItem, subscription: ISubscriptionContext) {
        super(parent, subscription);
    }

    public loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        throw new Error('Method not implemented.');
    }

    public hasMoreChildrenImpl(): boolean {
        throw new Error('Method not implemented.');
    }
}
