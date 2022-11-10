/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, openReadOnlyJson } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import { ApplicationResourceModel } from '../api/v2/v2AzureResourcesApi';
import { localize } from '../utils/localize';

export async function viewProperties(_context: IActionContext, node?: ApplicationResourceModel): Promise<void> {
    if (!node) {
        // TODO: Reenable this once we have a way to pick resources.
        // node = await pickAppResource<AppResourceTreeItem>(context);

        throw new Error(localize('commands.viewProperties.noSelectedResource', 'A resource must be selected.'));
    }

    if (!node.viewProperties) {
        throw new Error(localize('commands.viewProperties.noProperties', 'The selected resource has no properties to view.'));
    }

    await openReadOnlyJson({ fullId: node.id ?? randomUUID(), label: node.viewProperties.label }, node.viewProperties.data);
}
