/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProvideResourceOptions, WorkspaceResource, WorkspaceResourceProvider } from "./v2AzureResourcesApi";
import { ResourceProviderManagerBase } from './ResourceproviderManagerBase';
import { isArray } from '../../utils/v2/isArray';

export class WorkspaceResourceProviderManager extends ResourceProviderManagerBase<WorkspaceResource, WorkspaceResourceProvider> {
    constructor(extensionActivator: () => Promise<void>) {
        super(extensionActivator);
    }

    async provideResources(folder: vscode.WorkspaceFolder, options?: ProvideResourceOptions): Promise<WorkspaceResource[]> {
        const resourceProviders = await this.getResourceProviders();

        const resources = await Promise.all(resourceProviders.map(resourceProvider => resourceProvider.provideResources(folder, options)));

        return resources.filter(isArray).reduce((acc, result) => acc?.concat(result ?? []), []);
    }
}
