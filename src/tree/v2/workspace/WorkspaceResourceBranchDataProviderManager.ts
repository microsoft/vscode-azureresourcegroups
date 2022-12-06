/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BranchDataProvider, ResourceModelBase, WorkspaceResource } from '@microsoft/vscode-azext-utils/hostapi.v2';
import { ResourceBranchDataProviderManagerBase } from '../ResourceBranchDataProviderManagerBase';

export class WorkspaceResourceBranchDataProviderManager extends ResourceBranchDataProviderManagerBase<string, BranchDataProvider<WorkspaceResource, ResourceModelBase>> {
    constructor(
        defaultProvider: BranchDataProvider<WorkspaceResource, ResourceModelBase>,
        extensionActivator: (type: string) => void
    ) {
        super(
            defaultProvider,
            extensionActivator
        );
    }
}
