/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { WorkspaceResource, WorkspaceResourceProvider } from "./v2AzureResourcesApi";
import { ResourceProviderManagerBase } from './ResourceproviderManagerBase';

export class WorkspaceResourceProviderManager extends ResourceProviderManagerBase<vscode.WorkspaceFolder, WorkspaceResource, WorkspaceResourceProvider> {
    constructor(extensionActivator: () => Promise<void>) {
        super(extensionActivator);
    }
}
