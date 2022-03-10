/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { GenericResource, ResourceManagementClient } from "@azure/arm-resources";
import { uiUtils } from "@microsoft/vscode-azext-azureutils";
import { callWithTelemetryAndErrorHandling, IActionContext, ISubscriptionContext, nonNullProp } from "@microsoft/vscode-azext-utils";
import { AppResource, AppResourceProvider } from "./api";
import { createResourceClient } from "./utils/azureClients";


export class AzureResourceProvider implements AppResourceProvider {
    public async provideResources(subContext: ISubscriptionContext): Promise<AppResource[] | undefined> {
        return await callWithTelemetryAndErrorHandling('provideResources', async (context: IActionContext) => {

            const client: ResourceManagementClient = await createResourceClient([context, subContext]);
            // Load more currently broken https://github.com/Azure/azure-sdk-for-js/issues/20380

            const resources: GenericResource[] = await uiUtils.listAllIterator(client.resources.list());
            return resources.map((resource: GenericResource): AppResource => this.createAppResource(resource));
        });
    }

    private createAppResource(resource: GenericResource): AppResource {
        return {
            id: nonNullProp(resource, 'id'),
            name: nonNullProp(resource, 'name'),
            type: nonNullProp(resource, 'type'),
            kind: resource.kind,
            location: resource.location,
            ...resource
        };
    }
}
