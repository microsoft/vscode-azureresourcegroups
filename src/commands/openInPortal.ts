/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { azureResourceExperience, IActionContext, openUrl, ResourceGroupsItem } from '@microsoft/vscode-azext-utils';
import { Uri } from 'vscode';
import { ext } from '../extensionVariables';
import { localize } from '../utils/localize';

export async function openInPortal(context: IActionContext, node?: ResourceGroupsItem): Promise<void> {
    if (!node) {
        node = await azureResourceExperience({ ...context, dontUnwrap: true }, ext.v2.api.resources.azureResourceTreeDataProvider);
    }

    if (hasPortalUrl(node)) {
        return await openUrl(node.portalUrl.toString(/* skipEncoding: */ true));
    }

    throw new Error(localize('commands.openInPortal.noPortalLocation', 'The selected resource is not associated with location within the Azure portal.'));
}

export function hasPortalUrl(node: ResourceGroupsItem): node is { portalUrl: Uri } {
    return !!node && typeof node === 'object' && (node as { portalUrl: unknown }).portalUrl instanceof Uri;
}
