/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, IActionContext, openUrl } from '@microsoft/vscode-azext-utils';
import { BranchDataProviderItem } from '../tree/v2/BranchDataProviderItem';
import { localize } from '../utils/localize';

export async function openInPortal(_context: IActionContext, node?: AzExtTreeItem): Promise<void> {
    if (!node) {
        // TODO: Reenable this once we have a way to pick resources.
        // node = await pickAppResource<AppResourceTreeItem>(context);

        throw new Error(localize('commands.openInPortal.noSelectedResource', 'A resource must be selected.'));
    }

    if (node instanceof BranchDataProviderItem && node.portalUrl) {
        // NOTE: VS Code's URI type agressively encodes fragments heavily used in Portal URLs, but which the Portal doesn't understand, so skip encoding here.
        return await openUrl(node.portalUrl.toString(/* skipEncoding: */ true));
    }

    throw new Error(localize('commands.openInPortal.noPortalLocation', 'The selected resource is not associated with location within the Azure portal.'));
}
