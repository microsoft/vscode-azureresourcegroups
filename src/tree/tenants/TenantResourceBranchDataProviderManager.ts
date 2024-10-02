/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { BranchDataProvider, ResourceModelBase } from '../../../api/src/index';
import { ResourceBranchDataProviderManagerBase } from "../ResourceBranchDataProviderManagerBase";
import { TenantResource } from './tenant';

export class TenantResourceBranchDataProviderManager extends ResourceBranchDataProviderManagerBase<string, BranchDataProvider<TenantResource, ResourceModelBase>> {
    constructor(
        defaultProvider: BranchDataProvider<TenantResource, ResourceModelBase>
    ) {
        super(defaultProvider, () => { return 'tenant' });
    }
}
