/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtResourceType, AzureResource, AzureResourceBranchDataProvider, AzureResourceModel, BranchDataProvider, ResourceModelBase, ResourceTreeOperationContext } from "../../../api/src/index";
import { ResourceBranchDataProviderManagerBase } from '../ResourceBranchDataProviderManagerBase';

export class AzureResourceBranchDataProviderManager extends ResourceBranchDataProviderManagerBase<AzExtResourceType, BranchDataProvider<AzureResource, ResourceModelBase>>{
    constructor(
        defaultProvider: BranchDataProvider<AzureResource, ResourceModelBase>,
        extensionActivator: (type: AzExtResourceType) => Promise<void>
    ) {
        super(
            defaultProvider,
            extensionActivator
        );
    }
}

export type BranchDataProviderFactory = (
    resource: AzureResource,
    context?: ResourceTreeOperationContext
) => AzureResourceBranchDataProvider<AzureResourceModel> | Promise<AzureResourceBranchDataProvider<AzureResourceModel>>;
