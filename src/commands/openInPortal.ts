/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, IActionContext, openUrl, ResourceGroupsItem } from '@microsoft/vscode-azext-utils';
import { Uri } from 'vscode';
import { localize } from '../utils/localize';

export async function openInPortal(_context: IActionContext, node?: AzExtTreeItem): Promise<void> {
    if (!node) {
        // TODO: Reenable this once we have a way to pick resources.
        // node = await pickAppResource<AppResourceTreeItem>(context);

        throw new Error(localize('commands.openInPortal.noSelectedResource', 'A resource must be selected.'));
    }

    if (hasPortalUrl(node)) {
        return await openUrl(node.portalUrl.toString(/* skipEncoding: */ true));
    }

    throw new Error(localize('commands.openInPortal.noPortalLocation', 'The selected resource is not associated with location within the Azure portal.'));
}

function hasPortalUrl(node: ResourceGroupsItem): node is { portalUrl: Uri } {
    return !!node && typeof node === 'object' && (node as { portalUrl: unknown }).portalUrl instanceof Uri;
}
