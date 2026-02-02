/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BranchDataProvider, ResourceBase, ResourceModelBase } from "api/src";
import { ResourceBranchDataProviderManagerBase } from "../ResourceBranchDataProviderManagerBase";

export class ActivityLogResourceBranchDataProviderManager extends ResourceBranchDataProviderManagerBase<string, BranchDataProvider<ResourceBase, ResourceModelBase>> {
    constructor(
        defaultProvider: BranchDataProvider<ResourceBase, ResourceModelBase>
    ) {
        super(
            defaultProvider,
            () => { return 'activityLog'; }
        );
    }
}
