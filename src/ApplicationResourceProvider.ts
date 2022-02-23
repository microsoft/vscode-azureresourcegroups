/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Resource, ResourceManagementClient } from '@azure/arm-resources';
import { uiUtils } from '@microsoft/vscode-azext-azureutils';
import { IActionContext } from '@microsoft/vscode-azext-utils';
import { ProviderResult } from 'vscode';
import { ApplicationResourceProvider as ApiApplicationResourceProvider, GroupableApplicationResource } from './api';
import { ResourceTreeItem } from './tree/ResourceTreeItem';
import { SubscriptionTreeItem } from './tree/SubscriptionTreeItem';
import { createResourceClient } from './utils/azureClients';

export class ApplicationResourceProvider implements ApiApplicationResourceProvider {
    public async provideResources(context: IActionContext, subTreeItem: SubscriptionTreeItem): Promise<ProviderResult<GroupableApplicationResource[]>> {
        const client: ResourceManagementClient = await createResourceClient([context, subTreeItem]);

        // Load more currently broken https://github.com/Azure/azure-sdk-for-js/issues/20380
        const rgs: Resource[] = await uiUtils.listAllIterator(client.resources.list());
        return <ResourceTreeItem[]>await subTreeItem.createTreeItemsWithErrorHandling(
            rgs,
            'invalidResource',
            rg => new ResourceTreeItem(subTreeItem, rg),
            rg => rg.name
        );
    }
}
