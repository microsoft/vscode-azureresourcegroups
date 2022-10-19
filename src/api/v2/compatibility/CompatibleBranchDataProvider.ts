/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, ISubscriptionContext } from '@microsoft/vscode-azext-utils';
import type { AppResource, AppResourceResolver } from '@microsoft/vscode-azext-utils/hostapi';
import type { ApplicationResource, ResourceModelBase } from '../../../api/v2/v2AzureResourcesApi';
import { createSubscriptionContext } from '../../../utils/v2/credentialsUtils';
import { CompatibleResolvedApplicationResourceTreeItem } from './CompatibleApplicationResourceTreeItem';
import { CompatibleBranchDataProviderBase } from './CompatibleBranchDataProviderBase';

/**
 * Provides compatibility between an `AppResourceResolver` (v1) and a `BranchDataProvider` (v2)
 */
export class CompatibleBranchDataProvider<TResource extends ApplicationResource, TModel extends AzExtTreeItem & ResourceModelBase> extends CompatibleBranchDataProviderBase<TResource, TModel> {
    public constructor(private readonly resolver: AppResourceResolver, loadMoreCommandId: string) {
        super(loadMoreCommandId);
    }

    public async getResourceItem(element: TResource): Promise<TModel> {
        const oldAppResource: AppResource = {
            ...element,
            type: element.azureResourceType.type,
            kind: element.azureResourceType.kinds?.join(';'),
        };
        const subscriptionContext: ISubscriptionContext = createSubscriptionContext(element.subscription);

        const resolved = await this.resolver.resolveResource(subscriptionContext, oldAppResource);
        return CompatibleResolvedApplicationResourceTreeItem.Create(element, resolved!, subscriptionContext, this, element) as unknown as TModel;
    }
}
