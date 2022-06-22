import { GenericResource } from '@azure/arm-resources';
import { callWithTelemetryAndErrorHandling, IActionContext, ISubscriptionContext, nonNullProp } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { createResourceClient } from '../../../utils/azureClients';
import { ApplicationResource, ApplicationResourceProvider, ApplicationSubscription, ProvideResourceOptions } from '../v2AzureResourcesApi';
import { uiUtils } from "@microsoft/vscode-azext-azureutils";

export class BuiltInApplicationResourceProvider implements ApplicationResourceProvider {
    private readonly onDidChangeResourceEmitter = new vscode.EventEmitter<ApplicationResource | undefined>();

    provideResources(subscription: ApplicationSubscription, _options?: ProvideResourceOptions | undefined): Promise<ApplicationResource[] | undefined> {
        return callWithTelemetryAndErrorHandling(
            'provideResources',
            async (context: IActionContext) => {
                const subContext: ISubscriptionContext = {
                    subscriptionDisplayName: '',
                    subscriptionPath: '',
                    tenantId: '',
                    userId: '',
                    ...subscription
                };

                const client = await createResourceClient([context, subContext]);
                // Load more currently broken https://github.com/Azure/azure-sdk-for-js/issues/20380

                const resources: GenericResource[] = await uiUtils.listAllIterator(client.resources.list());
                return resources.map(resource => this.createAppResource(subscription, resource));
            });
    }

    onDidChangeResource = this.onDidChangeResourceEmitter.event;

    private createAppResource(subscription: ApplicationSubscription, resource: GenericResource): ApplicationResource {
        return {
            subscription,
            id: nonNullProp(resource, 'id'),
            name: nonNullProp(resource, 'name'),
            type: nonNullProp(resource, 'type'),
            kind: resource.kind,
            location: resource.location,
            ...resource
        };
    }
}
