/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApplicationResource, ApplicationResourceProvider, ApplicationSubscription } from './v2AzureResourcesApi';
import { ResourceProviderManagerBase } from './ResourceproviderManagerBase';

export class ApplicationResourceProviderManager extends ResourceProviderManagerBase<ApplicationSubscription, ApplicationResource, ApplicationResourceProvider> {
    constructor(extensionActivator: () => Promise<void>) {
        super(extensionActivator);
    }
}
