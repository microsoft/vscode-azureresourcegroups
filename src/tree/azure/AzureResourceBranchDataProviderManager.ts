/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtResourceType } from "@microsoft/vscode-azext-utils";
import { AzureResource, BranchDataProvider, ResourceModelBase } from "@microsoft/vscode-azext-utils/hostapi.v2";
import { ResourceBranchDataProviderManagerBase } from '../ResourceBranchDataProviderManagerBase';

export class AzureResourceBranchDataProviderManager extends ResourceBranchDataProviderManagerBase<AzExtResourceType, BranchDataProvider<AzureResource, ResourceModelBase>>{
    constructor(
        defaultProvider: BranchDataProvider<AzureResource, ResourceModelBase>,
        extensionActivator: (type: AzExtResourceType) => void
    ) {
        super(
            defaultProvider,
            extensionActivator
        );
    }
}

export type BranchDataProviderFactory = (resource: AzureResource) => BranchDataProvider<AzureResource, ResourceModelBase>;

