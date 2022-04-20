/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureAccountTreeItemBase } from '@microsoft/vscode-azext-azureutils';
import { IActionContext, ISubscriptionContext } from '@microsoft/vscode-azext-utils';
import { AppResourceResolver } from '@microsoft/vscode-azext-utils/hostapi';
import { SubscriptionTreeItem } from './SubscriptionTreeItem';

export class AzureAccountTreeItem extends AzureAccountTreeItemBase {
    public constructor(testAccount?: {}) {
        super(undefined, testAccount);
    }

    public createSubscriptionTreeItem(root: ISubscriptionContext): SubscriptionTreeItem {
        return new SubscriptionTreeItem(this, root);
    }

    public async resolveVisibleChildren(context: IActionContext, resolver: AppResourceResolver): Promise<void> {
        const children = await this.getCachedChildren(context) as SubscriptionTreeItem[];
        const childPromises = children.map(c => c.resolveVisibleChildren(context, resolver));

        await Promise.all(childPromises);
    }
}
