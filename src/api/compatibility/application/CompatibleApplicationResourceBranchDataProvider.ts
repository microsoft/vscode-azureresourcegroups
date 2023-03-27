/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, createSubscriptionContext, ISubscriptionContext } from '@microsoft/vscode-azext-utils';
import type { AppResource, AppResourceResolver } from '@microsoft/vscode-azext-utils/hostapi';
import type { AzureResource, ResourceModelBase } from '../../../../api/src/index';
import { CompatibleBranchDataProviderBase } from '../CompatibleBranchDataProviderBase';
import { CompatibleResolvedApplicationResourceTreeItem } from './CompatibleApplicationResourceTreeItem';

/**
 * Provides compatibility between an `AppResourceResolver` (v1) and a `BranchDataProvider` (v2)
 */
export class CompatibleApplicationResourceBranchDataProvider<TResource extends AzureResource, TModel extends AzExtTreeItem & ResourceModelBase> extends CompatibleBranchDataProviderBase<TResource, TModel> {
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
        // the fact that resolved can be null makes this painful to assert with nonNullValue
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const result = CompatibleResolvedApplicationResourceTreeItem.Create(element, resolved!, subscriptionContext, this, element) as unknown as TModel;
        Object.defineProperty(result, 'fullId', {
            get: () => {
                return element.id;
            }
        });
        Object.defineProperty(result, 'id', {
            get: () => {
                return element.id;
            }
        });

        return result;
    }
}
