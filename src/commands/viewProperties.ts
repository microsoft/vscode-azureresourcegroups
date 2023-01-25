/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { azureResourceExperience, IActionContext, openReadOnlyJson } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import { ViewPropertiesModel } from '../api/public';
import { ext } from '../extensionVariables';
import { ResourceGroupsItem } from '../tree/ResourceGroupsItem';
import { localize } from '../utils/localize';

export async function viewProperties(context: IActionContext, node?: ResourceGroupsItem): Promise<void> {
    if (!node) {
        node = await azureResourceExperience<ResourceGroupsItem>({ ...context, dontUnwrap: true }, ext.v2.api.resources.azureResourceTreeDataProvider);
    }

    if (!hasViewProperties(node)) {
        throw new Error(localize('commands.viewProperties.noProperties', 'The selected resource has no properties to view.'));
    }

    await openReadOnlyJson({ fullId: node.id ?? randomUUID(), label: node.viewProperties.label }, node.viewProperties.data);
}

function hasViewProperties(node: unknown): node is { viewProperties: ViewPropertiesModel } {
    return !!(node as { viewProperties: ViewPropertiesModel })?.viewProperties;
}
