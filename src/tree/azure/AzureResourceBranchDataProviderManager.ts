/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtResourceType, AzureResource, BranchDataProvider, ResourceModelBase } from "../../../api/src/index";
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

