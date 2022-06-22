import * as vscode from 'vscode';
import { ApplicationResource, ApplicationResourceProvider, ApplicationSubscription, ProvideResourceOptions } from '../v2AzureResourcesApi';

export class ApplicationResourceProviderManager {
    private readonly resourceProviders: ApplicationResourceProvider[] = [];

    addResourceProvider(resourceProvider: ApplicationResourceProvider): void {
        this.resourceProviders.push(resourceProvider);
    }

    removeResourceProvider(resourceProvider: ApplicationResourceProvider): void {
        this.resourceProviders.splice(this.resourceProviders.indexOf(resourceProvider), 1);
    }

    provideResources(subscription: ApplicationSubscription, options?: ProvideResourceOptions | undefined): vscode.ProviderResult<ApplicationResource[]> {
        return Promise.all(this.resourceProviders.map(resourceProvider => resourceProvider.provideResources(subscription, options))).then(results => {
            return results.reduce((acc, result) => acc?.concat(result ?? []), []);
        });
    }
}
