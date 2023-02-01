/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkspaceResource } from '@microsoft/vscode-azext-utils/hostapi';
import type { WorkspaceResource as v2WorkspaceResource } from '../../../../api/src/index';
import { CompatibleBranchDataProviderBase } from '../CompatibleBranchDataProviderBase';

export class CompatibleWorkspaceResourceBranchDataProvider<TResource extends WorkspaceResource & v2WorkspaceResource> extends CompatibleBranchDataProviderBase<TResource, TResource> {
    public async getResourceItem(element: TResource): Promise<TResource> {
        return element;
    }
}
