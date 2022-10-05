/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtResourceType } from "@microsoft/vscode-azext-utils";
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from "../../../api/v2/v2AzureResourcesApi";
import { ResourceBranchDataProviderManagerBase } from '../ResourceBranchDataProviderManagerBase';

export class ApplicationResourceBranchDataProviderManager extends ResourceBranchDataProviderManagerBase<AzExtResourceType, BranchDataProvider<ApplicationResource, ResourceModelBase>>{
    constructor(
        defaultProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>,
        extensionActivator: (type: AzExtResourceType) => void
    ) {
        super(
            defaultProvider,
            extensionActivator
        );
    }
}

export type BranchDataProviderFactory = (resource: ApplicationResource) => BranchDataProvider<ApplicationResource, ResourceModelBase>;

