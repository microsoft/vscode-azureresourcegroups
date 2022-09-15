/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApplicationResource, ApplicationResourceProvider, ApplicationSubscription, ProvideResourceOptions } from './v2AzureResourcesApi';
import { ResourceProviderManagerBase } from './ResourceproviderManagerBase';
import { isArray } from '../../utils/v2/isArray';

export class ApplicationResourceProviderManager extends ResourceProviderManagerBase<ApplicationResource, ApplicationResourceProvider> {
    constructor(extensionActivator: () => Promise<void>) {
        super(extensionActivator);
    }

    async getResources(subscription: ApplicationSubscription, options?: ProvideResourceOptions | undefined): Promise<ApplicationResource[]> {
        const resourceProviders = await this.getResourceProviders();

        const resources = await Promise.all(resourceProviders.map(resourceProvider => resourceProvider.getResources(subscription, options)));

        return resources.filter(isArray).reduce((acc, result) => acc?.concat(result ?? []), []);
    }
}
